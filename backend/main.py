"""pephouse backend — registry API + simulation/grader endpoints.

Run locally:
    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # then fill in
    uvicorn main:app --reload
"""

import logging
import os

import anyio
import stripe
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

import billing
import consult
import db
import junction
import modules
import report
import runs
import summaries
import tiers
import user_data
import user_stack
import vendors
from auth import AuthUser, assert_self, require_account, require_admin, require_user
from evidence import build_simulation_data
from interactions import build_interactions
from models import (
    BillingStatus,
    CheckoutResponse,
    CompoundEvidenceRequest,
    CompoundInput,
    ConfirmRequest,
    ConsultSessionRequest,
    ConsultSessionResponse,
    InteractionsResponse,
    IntakeResult,
    LabUploadResponse,
    LinkRequest,
    LinkResponse,
    PatientProfile,
    ProfilePatch,
    ProfileResponse,
    ScreenEligibilityRequest,
    SimulateRequest,
    SimulateResponse,
    SimulationDataResponse,
    StackAddRequest,
    StackItem,
    StackReportRequest,
    TrialIntake,
    TwinSimulateRequest,
    UserDataBundle,
    UserDataPatch,
    VendorReview,
    VendorSubmission,
    VendorSubmissionResult,
)
from twin_engine import run_simulation

logger = logging.getLogger("pephouse.main")

app = FastAPI(title="pephouse")

# Browser origins allowed to call this API. `*` would let any page on the
# internet issue authenticated requests with a member's browser, so access is
# explicit and `*` is rejected outright at startup.
#
# Vercel serves this frontend on several hostnames — the stable alias
# (frontend-alpha-wine-58), the project alias
# (frontend-andre-chuabios-projects), and a fresh per-deploy URL every push
# (frontend-<hash>-andre-chuabios-projects). Whitelisting one by name breaks the
# moment the browser is on another, so a regex covers the whole project plus its
# preview deploys, and an explicit list covers the fixed alias and local dev.
DEFAULT_ORIGINS = ",".join(
    [
        "https://frontend-alpha-wine-58.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",")
    if origin.strip()
]
if "*" in ALLOWED_ORIGINS:
    raise RuntimeError("ALLOWED_ORIGINS must name real origins; '*' is not permitted")

# Origins allowed by pattern rather than by exact name:
#   - the custom domain pephouse.org / .app and their www subdomains (the
#     production home; both TLDs accepted so the brand is not locked to one)
#   - every Vercel domain for THIS account's projects
#     (…-andre-chuabios-projects.vercel.app), including per-deploy preview hashes
# Scoped deliberately — not an open `*.vercel.app` — so a stranger's site cannot
# call the API, while a new deploy hash or the custom domain never breaks CORS.
# The fixed alias without the account suffix (frontend-alpha-wine-58) stays in
# the explicit list above.
DEFAULT_ORIGIN_REGEX = (
    r"https://(www\.)?pephouse\.(org|app)"
    r"|https://[a-z0-9-]+-andre-chuabios-projects\.vercel\.app"
)
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", DEFAULT_ORIGIN_REGEX)
logger.info("cors: allowing %s and regex %s", ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/compounds")
def list_compounds() -> list[dict]:
    return db.get_compounds()


@app.get("/compounds/{compound_id}")
def get_compound(compound_id: int) -> dict:
    compound = db.get_compound(compound_id)
    if compound is None:
        raise HTTPException(status_code=404, detail="compound not found")
    return compound


@app.get("/compounds/{compound_id}/evidence")
def get_evidence(compound_id: int) -> dict:
    """Tier-1 evidence bundle the grader is allowed to cite."""
    return db.get_evidence(compound_id)


@app.get("/evidence/summary")
def evidence_summary(nct: str | None = None, pmid: str | None = None, llm: bool = False) -> dict:
    """Tight summary of one evidence item for the Sim 2 side panel.

    `?nct=NCT...` for a trial or `?pmid=...` for a paper. Structured/instant by
    default; `&llm=true` condenses the live CT.gov/PubMed text with Claude
    (needs ANTHROPIC_API_KEY on the backend, else it falls back to structured).
    """
    result = summaries.summarize(nct=nct, pmid=pmid, llm=llm)
    if result is None:
        raise HTTPException(status_code=400, detail="provide nct or pmid")
    return result


@app.get("/interactions", response_model=InteractionsResponse)
def get_interactions(ids: str = "") -> InteractionsResponse:
    """Pairwise drug-interaction warnings for a set of compound ids.

    Query: `?ids=1,2,3`. Returns a row per unordered pair; pairs without
    documented rows in `drug_interactions` come back with severity='unknown'
    and source_kind='no_data' so the UI can surface the honest gap rather
    than show silence.
    """
    parsed: list[int] = []
    for token in ids.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            parsed.append(int(token))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"bad id: {token}")
    return build_interactions(parsed)


@app.get("/compounds/{compound_id}/data", response_model=SimulationDataResponse)
def get_compound_data(compound_id: int) -> SimulationDataResponse:
    """Supabase data layer for the simulation builder (Arena 2).

    Read-only: returns the compound, its evidence layers/tiers (for the evidence
    map toggles), outcome names, clusters, anecdotes, studied age range, and the
    Tier-4 cohort size. Does NOT run any Monte Carlo — use POST /simulate for that.
    """
    bundle = build_simulation_data(compound_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail="compound not found")
    return bundle


@app.post("/simulate", response_model=SimulateResponse)
def simulate(body: SimulateRequest) -> SimulateResponse:
    """Monte Carlo over outcome_priors; bodies from synthetic_patients in Supabase.

    BTW: this does not invoke Synthea — no JVM, no module run at request time.
    Cohort is pre-loaded in Supabase (see synthea/README.md).

    Nice future: call Synthea at enrollment time (cluster-specific module from
    case_studies + outcome_priors) to evolve comorbidities/labs over the horizon,
    while keeping Tier-1 effect draws in the Monte Carlo — not in the JVM.
    """
    if not body.compounds:
        raise HTTPException(status_code=400, detail="compounds required")
    for c in body.compounds:
        if db.get_compound(c.compound_id) is None:
            raise HTTPException(status_code=404, detail=f"compound {c.compound_id} not found")
    return run_simulation(
        compounds=body.compounds,
        patient=body.patient,
        outcomes=body.outcomes,
        n_draws=body.n_draws,
        seed=body.seed,
        source_type=body.source_type,
        live_cohort=body.live_cohort,
        tiers=body.tiers,
    )


@app.get("/compounds/{compound_id}/tiers")
def get_tiers(compound_id: int) -> dict:
    """Which data tiers are available for this compound (for the UI tier toggles)."""
    if db.get_compound(compound_id) is None:
        raise HTTPException(status_code=404, detail="compound not found")
    return tiers.availability(compound_id)


@app.get("/runs")
def list_runs(limit: int = 20) -> list[dict]:
    """Most-recent simulation runs (for the recent-runs list)."""
    return runs.get_recent_runs(limit)


@app.get("/runs/{run_id}")
def get_run(run_id: int) -> dict:
    """One saved run by id, including its live-generated cohort."""
    record = runs.get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return record


@app.post("/compounds/{compound_id}/module")
def generate_module(compound_id: int, _admin: AuthUser = Depends(require_admin)) -> dict:
    """Build + persist a Synthea Generic Module per outcome prior for this compound.

    Returns the saved modules. The most recent active module is auto-loaded by
    live cohort generation (live_cohort=true) so the run is compound-specific.

    Operator-only: this writes to the registry, so it is not a member surface.
    """
    if db.get_compound(compound_id) is None:
        raise HTTPException(status_code=404, detail="compound not found")
    saved = modules.generate_and_save(compound_id)
    if not saved:
        raise HTTPException(status_code=400, detail="no outcome_priors to build a module from")
    return {"compound_id": compound_id, "generated": len(saved), "modules": saved}


@app.get("/compounds/{compound_id}/modules")
def list_compound_modules(compound_id: int) -> list[dict]:
    """Recent Synthea modules for one compound."""
    return modules.get_recent_modules(compound_id)


@app.get("/modules")
def list_modules(limit: int = 20) -> list[dict]:
    """Most-recent Synthea modules across all compounds."""
    return modules.get_recent_modules(limit=limit)


@app.get("/modules/{module_id}")
def get_module(module_id: int) -> dict:
    """One module by id, including the full Generic Module JSON."""
    record = modules.get_module(module_id)
    if record is None:
        raise HTTPException(status_code=404, detail="module not found")
    return record


# ----------------------------------------------------------------- import API
# Patient-data import via Junction (wearable + bloodwork). The `user_ref` in each
# request is checked against the caller's verified session, so a member can only
# pull their own connected data. The Vital API key stays server-side in junction.py.


@app.post("/import/link", response_model=LinkResponse)
async def import_link(body: LinkRequest, user: AuthUser = Depends(require_user)) -> LinkResponse:
    """Create a Junction Link token + hosted URL to connect a wearable provider."""
    assert_self(user, body.user_ref)
    try:
        result = await junction.create_link_token(body.user_ref)
    except Exception as exc:  # noqa: BLE001 - surface Junction failures as 502
        raise HTTPException(status_code=502, detail=f"junction link failed: {exc}")
    return LinkResponse(**result)


@app.get("/import/profile", response_model=ProfileResponse)
async def import_profile(user_ref: str, user: AuthUser = Depends(require_user)) -> ProfileResponse:
    """Poll target: once a provider is linked, return a patient patch from it."""
    assert_self(user, user_ref)
    try:
        patch = await junction.get_profile_and_body(user_ref)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"junction profile failed: {exc}")
    if patch is None:
        return ProfileResponse(connected=False)
    return ProfileResponse(connected=True, patch=ProfilePatch(**patch))


@app.get("/import/labs", response_model=ProfilePatch)
async def import_labs(
    user_ref: str,
    order_id: str | None = None,
    user: AuthUser = Depends(require_user),
) -> ProfilePatch:
    """Pull a lab order's biomarkers and map flags to conditions."""
    assert_self(user, user_ref)
    try:
        patch = await junction.get_lab_results(user_ref, order_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"junction labs failed: {exc}")
    return ProfilePatch(**patch)


@app.get("/import/wearable")
async def import_wearable(user_ref: str, user: AuthUser = Depends(require_user)) -> dict:
    """Pull recent wearable metrics (sleep / steps / resting HR / HRV).

    Real Junction summary data where a provider is linked; realistic mock fill
    otherwise (sandbox wearable linking needs the hosted flow). `mocked` says which.
    """
    assert_self(user, user_ref)
    try:
        return await junction.get_wearable_metrics(user_ref)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"junction wearable failed: {exc}")


# ------------------------------------------------------------------- user data
# Persisted patient data a user connected (wearable / bloodwork) or reported.
# Mirrors the Junction import shape; mock today, live-Junction-swappable later.


@app.get("/users/{user_ref}/data", response_model=UserDataBundle)
def get_user_data(user_ref: str, user: AuthUser = Depends(require_user)) -> UserDataBundle:
    """getUserData — the full stored bundle (profile + wearable + labs) for a user."""
    assert_self(user, user_ref)
    bundle = user_data.get_user_data(user_ref)
    if bundle is None:
        raise HTTPException(status_code=404, detail="no data for this user")
    return UserDataBundle(**bundle)


@app.post("/users/{user_ref}/data", response_model=UserDataBundle)
def save_user_data(
    user_ref: str,
    body: UserDataPatch,
    user: AuthUser = Depends(require_user),
) -> UserDataBundle:
    """Save a connected/reported patch (upsert profile; replace labs/wearable)."""
    assert_self(user, user_ref)
    merged = user_data.save_user_data(user_ref, body.model_dump(exclude_none=True))
    return UserDataBundle(**merged)


@app.delete("/users/{user_ref}/data")
def delete_user_data(user_ref: str, user: AuthUser = Depends(require_user)) -> dict:
    """Delete every stored row for this user across all user-keyed tables.

    The settings-page "delete my data" control. Removes the user's rows from
    user_profiles, user_lab_results, user_wearable_metrics, user_stack and
    trial_intakes, returning per-table counts. Deleting a user_ref with no
    rows is a success (all counts zero), not an error.
    """
    assert_self(user, user_ref)
    try:
        tables = user_data.delete_user_data(user_ref)
        tables["user_stack"] = user_stack.delete_stack(user_ref)
        tables["trial_intakes"] = consult.delete_intakes(user_ref)
    except Exception as exc:  # noqa: BLE001 - surface Supabase failures as 502
        logger.error("data deletion failed for %s", user_ref, exc_info=True)
        raise HTTPException(status_code=502, detail=f"data deletion failed: {exc}")
    logger.info("deleted all data for %s: %s", user_ref, tables)
    return {"deleted": True, "tables": tables}


# ----------------------------------------------------------------- user stack
# The compounds a user added to their stack (compound + dose + source).


@app.get("/users/{user_ref}/stack", response_model=list[StackItem])
def get_user_stack(user_ref: str, user: AuthUser = Depends(require_user)) -> list[StackItem]:
    """List the user's stacked compounds."""
    assert_self(user, user_ref)
    return [StackItem(**row) for row in user_stack.get_stack(user_ref)]


@app.post("/users/{user_ref}/stack", response_model=list[StackItem])
def add_to_stack(
    user_ref: str,
    body: StackAddRequest,
    user: AuthUser = Depends(require_user),
) -> list[StackItem]:
    """Add a compound (with dose + source) to the user's stack; returns the stack."""
    assert_self(user, user_ref)
    user_stack.add_item(user_ref, body.model_dump())
    return [StackItem(**row) for row in user_stack.get_stack(user_ref)]


@app.delete("/users/{user_ref}/stack/{item_id}", response_model=list[StackItem])
def remove_from_stack(
    user_ref: str,
    item_id: int,
    user: AuthUser = Depends(require_user),
) -> list[StackItem]:
    """Remove a compound from the user's stack; returns the remaining stack."""
    assert_self(user, user_ref)
    user_stack.remove_item(user_ref, item_id)
    return [StackItem(**row) for row in user_stack.get_stack(user_ref)]


# ------------------------------------------------------------------ twin sim
# The Digital Twin's one-shot run: take the full payload (saved-or-supplied
# patient + compound stack + controls) and run the Monte Carlo over it.


@app.post("/twin/simulate", response_model=SimulateResponse)
def twin_simulate(
    body: TwinSimulateRequest,
    user: AuthUser = Depends(require_user),
) -> SimulateResponse:
    """Run a simulation from the Digital Twin's data + controls.

    Patient resolution: an explicit `patient` wins; otherwise the saved profile
    for `user_ref` is loaded from user_profiles. The compound stack and controls
    (tiers / source_type / n_draws) feed the same engine as POST /simulate.

    A `user_ref` here loads stored health data, so it must be the caller's own.
    """
    if body.user_ref:
        assert_self(user, body.user_ref)
    patient = body.patient
    if patient is None and body.user_ref:
        bundle = user_data.get_user_data(body.user_ref)
        if bundle is not None:
            patient = PatientProfile(
                age=int(bundle.get("age") or 40),
                sex=bundle.get("sex") or "M",
                weight_kg=bundle.get("weight_kg"),
                conditions=bundle.get("conditions") or [],
            )
    if patient is None:
        raise HTTPException(status_code=400, detail="patient or a known user_ref required")
    if not body.compounds:
        raise HTTPException(status_code=400, detail="compounds required")
    for cid in body.compounds:
        if db.get_compound(cid) is None:
            raise HTTPException(status_code=404, detail=f"compound {cid} not found")

    return run_simulation(
        compounds=[CompoundInput(compound_id=cid) for cid in body.compounds],
        patient=patient,
        outcomes=body.outcomes,
        n_draws=body.n_draws,
        seed=body.seed,
        source_type=body.source_type,
        live_cohort="synthetic" in (body.tiers or []),
        tiers=body.tiers,
    )


# --------------------------------------------------------------------- vendors
# The vendor index: who people actually buy from, and what is genuinely known
# about each. An education surface, not a storefront.
#
# The invariant, enforced in code rather than promised in copy: no vendor money
# can influence this data. There is no price, bid, or placement column anywhere
# in vendors.py, vendors hold no account and have no write path, and a submission
# buys a listing and nothing else. What a vendor says about itself is a claim and
# is returned tagged as one; only a third-party assay counts as evidence of
# testing. A vendor with nothing on file is listed anyway, saying so — that
# absence is the most informative field in the index.


@app.get("/vendors")
def list_vendors() -> list[dict]:
    """The vendor index with each vendor's evidence counts and testing grade."""
    return vendors.get_index()


@app.get("/vendors/submissions")
def list_vendor_submissions(
    status: str = "pending",
    limit: int = 100,
    _admin: AuthUser = Depends(require_admin),
) -> list[dict]:
    """Operator review queue. Declared before /vendors/{id} so it is not shadowed."""
    try:
        return vendors.list_submissions(status=status, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"submission queue failed: {exc}")


@app.post("/vendors/submissions", response_model=VendorSubmissionResult)
def submit_vendor(
    body: VendorSubmission,
    user: AuthUser = Depends(require_account),
) -> VendorSubmissionResult:
    """Record a vendor self-disclosure, or a member reporting a source they use.

    Requires a durable (non-anonymous) account: every submission is tied to a
    real identity, which is what makes one-per-vendor limits and abuse review
    possible and keeps a bot from flooding the queue. It lands as `pending` and
    is published only after operator review.
    """
    try:
        result = vendors.submit(body.model_dump(exclude_none=True), submitter_ref=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("vendor submission failed", exc_info=True)
        raise HTTPException(status_code=502, detail=f"submission failed: {exc}")
    return VendorSubmissionResult(**result)


@app.post("/vendors/submissions/{submission_id}/review")
def review_vendor_submission(
    submission_id: int,
    body: VendorReview,
    _admin: AuthUser = Depends(require_admin),
) -> dict:
    """Publish or reject a pending submission.

    Publishing a booth walk-up creates the canonical vendors row, so an approval
    actually lands in the directory instead of disappearing into a queue.
    """
    try:
        return vendors.review(submission_id, body.status, body.review_note, body.vendor_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("vendor review failed for %d", submission_id, exc_info=True)
        raise HTTPException(status_code=502, detail=f"review failed: {exc}")


@app.get("/vendors/for-compound/{compound_id}")
def vendors_for_compound(compound_id: int) -> dict:
    """Sources on file for one compound — the vendor-side view of the match.

    Same editorial, unpurchasable data the stack report uses, so the Vendors page
    can filter to "who has data for this compound". Declared before /vendors/{id}
    so the literal path is not captured by the numeric one.
    """
    return vendors.sources_for_compound(compound_id)


@app.get("/vendors/{vendor_id}")
def get_vendor(vendor_id: int) -> dict:
    """The full per-vendor breakdown: assays, claims, member reports, sourcing."""
    breakdown = vendors.get_breakdown(vendor_id)
    if breakdown is None:
        raise HTTPException(status_code=404, detail="vendor not found")
    return breakdown


# --------------------------------------------------------------------- billing
# Stripe Checkout and the entitlement it grants. The API boots with no Stripe key
# present so the rest of the product still deploys; only these endpoints refuse.


@app.get("/billing/status", response_model=BillingStatus)
def billing_status(user: AuthUser = Depends(require_user)) -> BillingStatus:
    """Whether this member holds access, and whether we can take a payment at all."""
    return BillingStatus(
        has_access=billing.has_access(user.id),
        configured=billing.is_configured(),
        price_cents=billing.PRICE_CENTS,
        currency=billing.CURRENCY,
    )


@app.post("/billing/checkout", response_model=CheckoutResponse)
def billing_checkout(user: AuthUser = Depends(require_account)) -> CheckoutResponse:
    """Open a Stripe Checkout session and hand back the URL to send the buyer to.

    A durable account is required: an anonymous session that is lost would take
    its entitlement with it, and the member would have paid for nothing.
    """
    origin = ALLOWED_ORIGINS[0]
    try:
        url = billing.create_checkout(user.id, user.email, origin)
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("checkout failed for %s", user.id, exc_info=True)
        raise HTTPException(status_code=502, detail=f"checkout failed: {exc}")
    return CheckoutResponse(checkout_url=url)


@app.post("/billing/confirm", response_model=BillingStatus)
def billing_confirm(
    body: ConfirmRequest,
    user: AuthUser = Depends(require_account),
) -> BillingStatus:
    """Confirm a Checkout session on the member's return and grant if it is paid.

    This is what makes a first sale work before any webhook endpoint has been
    configured in the Stripe dashboard. The session is fetched from Stripe, not
    trusted from the query string, and its buyer must be the caller.
    """
    try:
        billing.confirm(body.session_id, user.id)
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("confirm failed for %s", user.id, exc_info=True)
        raise HTTPException(status_code=502, detail=f"confirm failed: {exc}")
    return BillingStatus(
        has_access=billing.has_access(user.id),
        configured=billing.is_configured(),
        price_cents=billing.PRICE_CENTS,
        currency=billing.CURRENCY,
    )


@app.post("/billing/webhook")
async def billing_webhook(request: Request) -> dict:
    """Stripe webhook. Signature-verified; an unsigned body is refused.

    Unauthenticated by necessity (Stripe calls it), which is exactly why the
    signature check is not optional: granting on an unverified POST would let
    anyone mint themselves a paid entitlement.
    """
    payload = await request.body()
    signature = request.headers.get("Stripe-Signature")
    try:
        event_type = billing.handle_webhook(payload, signature)
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except (ValueError, stripe.SignatureVerificationError) as exc:
        logger.warning("billing: rejected webhook: %s", exc)
        raise HTTPException(status_code=400, detail="invalid webhook")
    return {"received": True, "type": event_type}


# ---------------------------------------------------------------- stack report
# The paid product. Deterministic and registry-derived: no model call, so it
# costs a fraction of a cent to serve and every line can be audited against the
# table it came from.


@app.post("/report")
def stack_report(
    body: StackReportRequest,
    user: AuthUser = Depends(require_user),
) -> dict:
    """The tier-honest evidence read on a member's stack. Requires an entitlement."""
    if not billing.has_access(user.id):
        raise HTTPException(status_code=402, detail="payment required")
    try:
        return report.build(body.compounds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("report failed for %s", user.id, exc_info=True)
        raise HTTPException(status_code=502, detail=f"report failed: {exc}")


@app.post("/report/preview")
def stack_report_preview(body: StackReportRequest) -> dict:
    """The free teaser: the verdict line per compound, without the evidence behind it.

    This is what a member sees before paying, and it is deliberately honest rather
    than coy — it tells them the shape of the answer ("nothing in this stack is
    trial-backed") and sells the detail, not the conclusion. Withholding the
    conclusion itself would make the paywall the thing that decides whether
    somebody learns their compound has no evidence, which is the one outcome this
    product exists to prevent.
    """
    try:
        full = report.build(body.compounds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "summary": full["summary"],
        "compounds": [
            {
                "compound_id": c["compound_id"],
                "name": c["name"],
                "top_tier": c["top_tier"],
                "verdict": c["verdict"],
                "verdict_text": c["verdict_text"],
                # The source match ships FREE: no one should pay a dollar to learn
                # that no source has been independently tested for what they inject.
                # That is harm-reduction information, not a paywalled feature.
                "sources": c["sources"],
            }
            for c in full["compounds"]
        ],
        "locked": ["evidence_ladder", "trials", "interactions", "counts"],
    }


# -------------------------------------------------------------------- consult
# The Tavus CVI front. DISABLED by default: CVI bills real money per wall-clock
# minute, which no few-dollar product can carry, so it is off unless
# CONSULT_ENABLED is explicitly set. The code stays mounted and metered so it can
# be switched back on as a priced extra without a rebuild.

CONSULT_ENABLED = os.getenv("CONSULT_ENABLED", "false").lower() in ("1", "true", "yes")
if not CONSULT_ENABLED:
    logger.info("consult: disabled (set CONSULT_ENABLED=true to re-enable)")


def require_consult_enabled() -> None:
    """Dependency: 404 the consult surface unless it has been switched on."""
    if not CONSULT_ENABLED:
        raise HTTPException(status_code=404, detail="not found")


@app.post("/consult/session", response_model=ConsultSessionResponse)
async def consult_session(
    body: ConsultSessionRequest,
    user: AuthUser = Depends(require_user),
    _on: None = Depends(require_consult_enabled),
) -> ConsultSessionResponse:
    """Mint a cost-bounded Tavus conversation seeded with the member's context.

    Every conversation costs real money per wall-clock minute and Tavus enforces
    no spend ceiling of its own, so this endpoint is authenticated and metered.
    A budget refusal is a 429, not a 502 — the request is well-formed, we are
    simply out of minutes.
    """
    assert_self(user, body.user_ref or "")
    try:
        return await consult.start_session(body)
    except consult.BudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - surface Tavus/config failures as 502
        raise HTTPException(status_code=502, detail=f"consult session failed: {exc}")


@app.post("/consult/tools/get_compound_evidence")
def consult_get_compound_evidence(
    body: CompoundEvidenceRequest,
    _user: AuthUser = Depends(require_user),
    _on: None = Depends(require_consult_enabled),
) -> dict:
    """Tool backing: the tier ladder + demographic-filtered narratives for a compound."""
    try:
        return consult.get_compound_evidence(body)
    except Exception as exc:  # noqa: BLE001 - surface data-layer failures as 502
        raise HTTPException(status_code=502, detail=f"evidence lookup failed: {exc}")


@app.post("/consult/tools/screen_eligibility")
def consult_screen_eligibility(
    body: ScreenEligibilityRequest,
    _user: AuthUser = Depends(require_user),
    _on: None = Depends(require_consult_enabled),
) -> dict:
    """Tool backing: run the twin over the full tier ladder; void returns lower-tier signal."""
    try:
        return consult.screen_eligibility(body)
    except Exception as exc:  # noqa: BLE001 - surface engine failures as 502
        raise HTTPException(status_code=502, detail=f"eligibility screen failed: {exc}")


@app.post("/consult/intake", response_model=IntakeResult)
def consult_intake(body: TrialIntake, user: AuthUser = Depends(require_user)) -> IntakeResult:
    """Capture a trial-referral intake row after the consult."""
    assert_self(user, body.user_ref or "")
    try:
        result = consult.insert_intake(body)
    except Exception as exc:  # noqa: BLE001 - surface Supabase failures as 502
        raise HTTPException(status_code=502, detail=f"intake insert failed: {exc}")
    return IntakeResult(**result)


@app.get("/consult/intakes")
def consult_intakes(limit: int = 100, _admin: AuthUser = Depends(require_admin)) -> list[dict]:
    """Coordinator queue: intakes, most recent first.

    Operator-only. These rows carry members' goals, eligibility reads, and health
    context; this endpoint served all of it to the public internet before auth.
    """
    return consult.list_intakes(limit)


@app.get("/consult/dossiers/{slug}", response_class=PlainTextResponse)
def consult_dossier(slug: str) -> PlainTextResponse:
    """Serve a public evidence dossier as text/plain for the Tavus knowledge base.

    Exposes only already-public registry data (no PHI). Unknown slugs 404.
    """
    text = consult.get_dossier_text(slug)
    if text is None:
        raise HTTPException(status_code=404, detail=f"no dossier for '{slug}'")
    return PlainTextResponse(text, media_type="text/plain; charset=utf-8")


@app.post("/consult/labs/upload", response_model=LabUploadResponse)
async def consult_labs_upload(
    user_ref: str = Form(...),
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
) -> LabUploadResponse:
    """Extract biomarkers from a lab PDF and merge them onto the user's stored data."""
    assert_self(user, user_ref)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        # upload_labs blocks (pypdf parse, a synchronous 45s Anthropic call, and
        # Supabase writes); offload it so it never stalls the event loop for other
        # requests while one member's PDF is processed.
        return await anyio.to_thread.run_sync(consult.upload_labs, user_ref, data)
    except Exception as exc:  # noqa: BLE001 - surface extraction/store failures as 502
        raise HTTPException(status_code=502, detail=f"lab upload failed: {exc}")


# TODO(grader): POST /grade -> score a clinician transcript against get_evidence()
