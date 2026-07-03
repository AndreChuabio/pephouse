"""pephouse backend — registry API + simulation/grader endpoints.

Run locally:
    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # then fill in
    uvicorn main:app --reload
"""

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import consult
import db
import junction
import modules
import runs
import summaries
import tiers
import user_data
import user_stack
from evidence import build_simulation_data
from interactions import build_interactions
from models import (
    CompoundEvidenceRequest,
    CompoundInput,
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
    TrialIntake,
    TwinSimulateRequest,
    UserDataBundle,
    UserDataPatch,
)
from twin_engine import run_simulation

app = FastAPI(title="pephouse")

# Open CORS for the hackathon; tighten before any real deploy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
def generate_module(compound_id: int) -> dict:
    """Build + persist a Synthea Generic Module per outcome prior for this compound.

    Returns the saved modules. The most recent active module is auto-loaded by
    live cohort generation (live_cohort=true) so the run is compound-specific.
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
# Patient-data import via Junction (wearable + bloodwork). The frontend keys a
# per-browser `user_ref`; the Vital API key stays server-side in junction.py.


@app.post("/import/link", response_model=LinkResponse)
async def import_link(body: LinkRequest) -> LinkResponse:
    """Create a Junction Link token + hosted URL to connect a wearable provider."""
    if not body.user_ref:
        raise HTTPException(status_code=400, detail="user_ref required")
    try:
        result = await junction.create_link_token(body.user_ref)
    except Exception as exc:  # noqa: BLE001 - surface Junction failures as 502
        raise HTTPException(status_code=502, detail=f"junction link failed: {exc}")
    return LinkResponse(**result)


@app.get("/import/profile", response_model=ProfileResponse)
async def import_profile(user_ref: str) -> ProfileResponse:
    """Poll target: once a provider is linked, return a patient patch from it."""
    try:
        patch = await junction.get_profile_and_body(user_ref)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"junction profile failed: {exc}")
    if patch is None:
        return ProfileResponse(connected=False)
    return ProfileResponse(connected=True, patch=ProfilePatch(**patch))


@app.get("/import/labs", response_model=ProfilePatch)
async def import_labs(user_ref: str, order_id: str | None = None) -> ProfilePatch:
    """Pull a lab order's biomarkers and map flags to conditions."""
    try:
        patch = await junction.get_lab_results(user_ref, order_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"junction labs failed: {exc}")
    return ProfilePatch(**patch)


@app.get("/import/wearable")
async def import_wearable(user_ref: str) -> dict:
    """Pull recent wearable metrics (sleep / steps / resting HR / HRV).

    Real Junction summary data where a provider is linked; realistic mock fill
    otherwise (sandbox wearable linking needs the hosted flow). `mocked` says which.
    """
    try:
        return await junction.get_wearable_metrics(user_ref)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"junction wearable failed: {exc}")


# ------------------------------------------------------------------- user data
# Persisted patient data a user connected (wearable / bloodwork) or reported.
# Mirrors the Junction import shape; mock today, live-Junction-swappable later.


@app.get("/users/{user_ref}/data", response_model=UserDataBundle)
def get_user_data(user_ref: str) -> UserDataBundle:
    """getUserData — the full stored bundle (profile + wearable + labs) for a user."""
    bundle = user_data.get_user_data(user_ref)
    if bundle is None:
        raise HTTPException(status_code=404, detail="no data for this user")
    return UserDataBundle(**bundle)


@app.post("/users/{user_ref}/data", response_model=UserDataBundle)
def save_user_data(user_ref: str, body: UserDataPatch) -> UserDataBundle:
    """Save a connected/reported patch (upsert profile; replace labs/wearable)."""
    if not user_ref:
        raise HTTPException(status_code=400, detail="user_ref required")
    merged = user_data.save_user_data(user_ref, body.model_dump(exclude_none=True))
    return UserDataBundle(**merged)


# ----------------------------------------------------------------- user stack
# The compounds a user added to their stack (compound + dose + source).


@app.get("/users/{user_ref}/stack", response_model=list[StackItem])
def get_user_stack(user_ref: str) -> list[StackItem]:
    """List the user's stacked compounds."""
    return [StackItem(**row) for row in user_stack.get_stack(user_ref)]


@app.post("/users/{user_ref}/stack", response_model=list[StackItem])
def add_to_stack(user_ref: str, body: StackAddRequest) -> list[StackItem]:
    """Add a compound (with dose + source) to the user's stack; returns the stack."""
    if not user_ref:
        raise HTTPException(status_code=400, detail="user_ref required")
    user_stack.add_item(user_ref, body.model_dump())
    return [StackItem(**row) for row in user_stack.get_stack(user_ref)]


@app.delete("/users/{user_ref}/stack/{item_id}", response_model=list[StackItem])
def remove_from_stack(user_ref: str, item_id: int) -> list[StackItem]:
    """Remove a compound from the user's stack; returns the remaining stack."""
    user_stack.remove_item(user_ref, item_id)
    return [StackItem(**row) for row in user_stack.get_stack(user_ref)]


# ------------------------------------------------------------------ twin sim
# The Digital Twin's one-shot run: take the full payload (saved-or-supplied
# patient + compound stack + controls) and run the Monte Carlo over it.


@app.post("/twin/simulate", response_model=SimulateResponse)
def twin_simulate(body: TwinSimulateRequest) -> SimulateResponse:
    """Run a simulation from the Digital Twin's data + controls.

    Patient resolution: an explicit `patient` wins; otherwise the saved profile
    for `user_ref` is loaded from user_profiles. The compound stack and controls
    (tiers / source_type / n_draws) feed the same engine as POST /simulate.
    """
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


# -------------------------------------------------------------------- consult
# The Tavus CVI clinician front. POST /consult/session mints a conversation
# seeded with a PHI-minimized context. Tools are delivered as app_message, so the
# tool_call events are handled client-side and forwarded to the plain tool-backing
# endpoints below (get_compound_evidence / screen_eligibility / intake). There is
# no Tavus webhook to expose. The Tavus key stays server-side in consult.py.


@app.post("/consult/session", response_model=ConsultSessionResponse)
async def consult_session(body: ConsultSessionRequest) -> ConsultSessionResponse:
    """Mint a Tavus conversation seeded with the member's PHI-minimized context."""
    try:
        return await consult.start_session(body)
    except Exception as exc:  # noqa: BLE001 - surface Tavus/config failures as 502
        raise HTTPException(status_code=502, detail=f"consult session failed: {exc}")


@app.post("/consult/tools/get_compound_evidence")
def consult_get_compound_evidence(body: CompoundEvidenceRequest) -> dict:
    """Tool backing: the tier ladder + demographic-filtered narratives for a compound."""
    return consult.get_compound_evidence(body)


@app.post("/consult/tools/screen_eligibility")
def consult_screen_eligibility(body: ScreenEligibilityRequest) -> dict:
    """Tool backing: run the twin over the full tier ladder; void returns lower-tier signal."""
    return consult.screen_eligibility(body)


@app.post("/consult/intake", response_model=IntakeResult)
def consult_intake(body: TrialIntake) -> IntakeResult:
    """Capture a trial-referral intake row after the consult."""
    if not body.user_ref:
        raise HTTPException(status_code=400, detail="user_ref required")
    try:
        result = consult.insert_intake(body)
    except Exception as exc:  # noqa: BLE001 - surface Supabase failures as 502
        raise HTTPException(status_code=502, detail=f"intake insert failed: {exc}")
    return IntakeResult(**result)


@app.get("/consult/intakes")
def consult_intakes(limit: int = 100) -> list[dict]:
    """Coordinator queue: intakes, most recent first."""
    return consult.list_intakes(limit)


@app.post("/consult/labs/upload", response_model=LabUploadResponse)
async def consult_labs_upload(user_ref: str = Form(...), file: UploadFile = File(...)) -> LabUploadResponse:
    """Extract biomarkers from a lab PDF and merge them onto the user's stored data."""
    if not user_ref:
        raise HTTPException(status_code=400, detail="user_ref required")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        return consult.upload_labs(user_ref, data)
    except Exception as exc:  # noqa: BLE001 - surface extraction/store failures as 502
        raise HTTPException(status_code=502, detail=f"lab upload failed: {exc}")


# TODO(grader): POST /grade -> score a clinician transcript against get_evidence()
