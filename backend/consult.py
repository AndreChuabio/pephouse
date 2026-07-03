"""Consult layer — the Tavus CVI clinician front for pephouse.

A consult session mints a Tavus conversation (POST /v2/conversations) seeded with
a PHI-minimized context string. Tavus tools are delivered as ``app_message``
events, so tool calls arrive in the browser over the Daily data channel; the
frontend forwards each one to a plain endpoint here and returns the result to the
persona. There is therefore no Tavus webhook to expose.

Vocabulary (Tavus): PAL = persona, face = replica. The API host is
https://tavusapi.com and auth is the ``x-api-key`` header. The key lives only in
this process (backend/.env); the browser never sees it.

Privacy invariant: the conversational context and the intake context_snapshot
carry only flags / ranges / trend direction as text — never a raw lab value.
``build_conversational_context`` and ``minimize_labs`` hold that logic and are
unit-tested without any network in test_consult.py.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

import httpx

import db
import user_data
from evidence import build_simulation_data
from db import supabase
from models import (
    CompoundEvidenceRequest,
    CompoundInput,
    ConsultSessionRequest,
    ConsultSessionResponse,
    LabUploadResponse,
    LabValue,
    PatientProfile,
    ScreenEligibilityRequest,
    TrialIntake,
)
from twin_engine import run_simulation

logger = logging.getLogger("pephouse.consult")

TAVUS_HOST = "https://tavusapi.com"
DOCUMENT_TAGS = ["pephouse-evidence"]
# Full tier ladder for a consult screen: trial-grade first, then quality (source
# axis), anecdote (illustrative), and a live synthetic cohort as last resort.
SCREEN_TIERS = ["trial", "quality", "anecdote", "synthetic"]
DEFAULT_OUTCOMES = ["weight_change_pct"]
SCREEN_N_DRAWS = 3000
SCREEN_SEED = 42

ANTHROPIC_MODEL = os.environ.get("SUMMARY_MODEL", "claude-haiku-4-5-20251001")


# =========================================================== config helpers


def _tavus_key() -> str:
    key = os.environ.get("TAVUS_API_KEY")
    if not key:
        raise RuntimeError("TAVUS_API_KEY is not set (see backend/.env.example)")
    return key


def _tavus_ids() -> tuple[str, str]:
    pal_id = os.environ.get("TAVUS_PAL_ID")
    face_id = os.environ.get("TAVUS_FACE_ID")
    if not pal_id or not face_id:
        raise RuntimeError("TAVUS_PAL_ID and TAVUS_FACE_ID must be set (see backend/.env.example)")
    return pal_id, face_id


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# =============================================================== PHI minimize
# Pure, network-free, unit-tested. Keep the privacy invariant here: labs are
# reduced to a flag/status and (optionally) a reference range — never the value.


def minimize_labs(labs: list[dict] | None) -> list[str]:
    """Reduce labs to ``name: status (ref low-high)`` phrases, values withheld.

    A raw measured ``value`` is never emitted. Only the qualitative flag/status
    and, when present, the reference range (a range, not a measurement) survive.
    """
    phrases: list[str] = []
    for lab in labs or []:
        name = lab.get("name")
        if not name:
            continue
        status = lab.get("status") or lab.get("flag")
        if not status:
            # No flag and no value we are willing to share -> nothing useful to say.
            continue
        phrase = f"{name}: {status}"
        low = lab.get("ref_low")
        high = lab.get("ref_high")
        if low is not None or high is not None:
            phrase += f" (ref {low if low is not None else ''}-{high if high is not None else ''})"
        phrases.append(phrase)
    return phrases


def build_conversational_context(
    bundle: dict | None,
    goal: str | None = None,
    compound_name: str | None = None,
) -> str:
    """Assemble the PHI-minimized context string seeded into the Tavus conversation.

    Includes framing (goal / compound), demographics (age / sex / weight — needed
    for dosing and eligibility counsel), reported conditions, and biomarker FLAGS
    with reference ranges. Raw lab values are never included.
    """
    lines: list[str] = []
    if goal:
        lines.append(f"Member goal: {goal}.")
    if compound_name:
        lines.append(f"Compound of interest: {compound_name}.")

    if not bundle:
        lines.append("No connected member data; counsel from evidence only and ask clarifying questions.")
        return " ".join(lines)

    demo: list[str] = []
    if bundle.get("age") is not None:
        demo.append(f"age {bundle['age']}")
    if bundle.get("sex"):
        demo.append(f"sex {bundle['sex']}")
    if bundle.get("weight_kg") is not None:
        demo.append(f"weight {bundle['weight_kg']} kg")
    if demo:
        lines.append("Demographics: " + ", ".join(demo) + ".")

    conditions = bundle.get("conditions") or []
    if conditions:
        lines.append("Reported conditions: " + ", ".join(conditions) + ".")

    goals = bundle.get("goals") or []
    if goals:
        lines.append("Stated goals: " + ", ".join(goals) + ".")

    lab_flags = minimize_labs(bundle.get("labs"))
    if lab_flags:
        lines.append(
            "Biomarker flags (raw values withheld for privacy): " + "; ".join(lab_flags) + "."
        )

    if bundle.get("wearable"):
        lines.append("Wearable data is connected (trends available on request).")

    lines.append(
        "You may only cite trial-grade evidence as evidence; anecdote is context, never proof."
    )
    return " ".join(lines)


# ================================================================== Tavus API


async def create_conversation(context: str, document_tags: list[str]) -> dict:
    """POST /v2/conversations. Returns the raw Tavus JSON. Raises on HTTP error."""
    key = _tavus_key()
    pal_id, face_id = _tavus_ids()
    body = {
        "pal_id": pal_id,
        "face_id": face_id,
        "conversational_context": context,
        "document_tags": document_tags,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{TAVUS_HOST}/v2/conversations",
            headers={"x-api-key": key, "content-type": "application/json"},
            json=body,
        )
        res.raise_for_status()
        return res.json()


async def start_session(body: ConsultSessionRequest) -> ConsultSessionResponse:
    """Build the PHI-minimized context and mint a Tavus conversation for it."""
    bundle = None
    if body.user_ref:
        try:
            bundle = user_data.get_user_data(body.user_ref)
        except Exception:  # noqa: BLE001 - a data-store miss must not block the consult
            logger.warning("consult: could not load user_data for %s", body.user_ref, exc_info=True)
            bundle = None

    context = build_conversational_context(bundle, goal=body.goal, compound_name=body.compound_name)
    pal_id, _ = _tavus_ids()

    try:
        data = await create_conversation(context, DOCUMENT_TAGS)
    except httpx.HTTPStatusError as exc:
        logger.error("consult: Tavus conversation failed (%s): %s", exc.response.status_code, exc.response.text)
        raise
    except httpx.HTTPError:
        logger.error("consult: Tavus conversation transport error", exc_info=True)
        raise

    return ConsultSessionResponse(
        conversation_url=data.get("conversation_url", ""),
        conversation_id=data.get("conversation_id", ""),
        pal_id=data.get("pal_id") or pal_id,
    )


# ========================================================== compound resolve


def resolve_compound(compound_name: str | None) -> int | None:
    """Resolve a free-text compound name to its registry id (exact, then substring)."""
    if not compound_name:
        return None
    target = compound_name.strip().lower()
    if not target:
        return None
    compounds = db.get_compounds()
    for c in compounds:
        if str(c.get("name", "")).strip().lower() == target:
            return c.get("id")
    for c in compounds:
        if target in str(c.get("name", "")).strip().lower():
            return c.get("id")
    return None


def _filter_by_demographic(rows: list[dict], demographic: str | None) -> list[dict]:
    """Best-effort demographic filter over free-text rows.

    Keeps rows whose serialized text mentions the demographic token. Never hides
    everything: if the filter empties the set, the unfiltered rows are returned so
    the persona always has lower-tier context to work with.
    """
    if not demographic:
        return rows
    token = demographic.strip().lower()
    if not token:
        return rows
    kept = [r for r in rows if token in json.dumps(r, default=str).lower()]
    return kept or rows


# ================================================================ tool: evidence


def get_compound_evidence(req: CompoundEvidenceRequest) -> dict:
    """Tool backing get_compound_evidence: the tier ladder + filtered narratives.

    Returns evidence_sources + tables (the tier ladder from /compounds/{id}/data)
    and case_studies / anecdotes filtered by demographic when one is supplied.
    """
    cid = resolve_compound(req.compound_name)
    if cid is None:
        return {
            "found": False,
            "compound_name": req.compound_name,
            "message": f"No registry compound matched '{req.compound_name}'.",
            "evidence_sources": [],
            "tables": {},
            "case_studies": [],
            "anecdotes": [],
        }

    bundle = build_simulation_data(cid)
    if bundle is None:
        return {
            "found": False,
            "compound_id": cid,
            "compound_name": req.compound_name,
            "message": "Compound resolved but no data bundle is available.",
            "evidence_sources": [],
            "tables": {},
            "case_studies": [],
            "anecdotes": [],
        }

    tables = bundle.tables
    case_studies = _filter_by_demographic(tables.get("case_studies", []), req.demographic)
    anecdotes = _filter_by_demographic(tables.get("anecdotes", []), req.demographic)

    return {
        "found": True,
        "compound_id": cid,
        "name": bundle.name,
        "summary": bundle.summary,
        "evidence_sources": [s.model_dump() for s in bundle.evidence_sources],
        "outcome_names": bundle.outcome_names,
        "studied_age_min": bundle.studied_age_min,
        "studied_age_max": bundle.studied_age_max,
        "tables": tables,
        "case_studies": case_studies,
        "anecdotes": anecdotes,
        "demographic": req.demographic,
    }


# ============================================================ tool: eligibility


def _eligibility_read(resp, trial_outcomes: list) -> tuple[str, str | None]:
    """Map a simulation response to an eligibility verdict + reason.

    Never a bare refusal: a void or excluded read still returns a verdict and a
    human reason, and the caller attaches the lower-tier signal alongside it.
    """
    if trial_outcomes:
        return "eligible", None
    if resp.excluded_priors:
        first = resp.excluded_priors[0]
        return "excluded", first.reason
    return "no_trial", "No trial-grade evidence for this compound and outcome; showing lower-tier signal."


def screen_eligibility(req: ScreenEligibilityRequest) -> dict:
    """Tool backing screen_eligibility: run the twin over the full tier ladder.

    On a trial-backed outcome, return the quarter bands. On distribution_void (no
    trial signal) return the anecdotes + tier_notes + cohort echo instead — never
    an empty refusal.
    """
    cid = resolve_compound(req.compound_name)
    if cid is None:
        return {
            "found": False,
            "compound_name": req.compound_name,
            "eligibility": "unknown",
            "eligibility_reason": f"No registry compound matched '{req.compound_name}'.",
            "quarters": [],
            "outcomes": [],
            "anecdotes": [],
            "tier_notes": [],
            "cohort_n": 0,
        }

    patient = PatientProfile(
        age=req.age,
        sex=req.sex,
        weight_kg=req.weight_kg,
        conditions=req.conditions or [],
    )
    priors = db.get_outcome_priors(cid)
    outcome_names = sorted({p["outcome_name"] for p in priors if p.get("outcome_name")}) or DEFAULT_OUTCOMES

    resp = run_simulation(
        compounds=[CompoundInput(compound_id=cid)],
        patient=patient,
        outcomes=outcome_names,
        n_draws=SCREEN_N_DRAWS,
        seed=SCREEN_SEED,
        source_type=None,
        live_cohort=False,
        tiers=SCREEN_TIERS,
    )

    trial_outcomes = [o for o in resp.outcomes if o.trial_backed and not o.distribution_void]
    eligibility, reason = _eligibility_read(resp, trial_outcomes)

    # Always echo the lower-tier signal so the persona is never left empty-handed.
    anecdotes = [a.model_dump() for a in resp.anecdotes]
    result = {
        "found": True,
        "compound_id": cid,
        "compound_name": req.compound_name,
        "eligibility": eligibility,
        "eligibility_reason": reason,
        "outcomes": [o.model_dump() for o in resp.outcomes],
        "anecdotes": anecdotes,
        "tier_notes": resp.tier_notes,
        "tiers_used": resp.tiers_used,
        "cohort_n": resp.cohort_n,
        "cohort_source": resp.cohort_source,
        "cohort_callout": resp.cohort_callout,
        "data_confidence": resp.data_confidence,
    }
    if trial_outcomes:
        result["quarters"] = [q.model_dump() for q in trial_outcomes[0].quarters]
    else:
        result["quarters"] = []
        result["distribution_void"] = True
    return result


# ================================================================ tool: intake


def insert_intake(intake: TrialIntake) -> dict:
    """Insert a trial_intakes row and return ``{id, status}``.

    Resolves the compound name to an id when possible; persists only the minimized
    context_snapshot passed in (the caller is responsible for keeping it PHI-free).
    """
    compound_id = resolve_compound(intake.compound_name)
    row = {
        "user_ref": intake.user_ref,
        "goal": intake.goal,
        "compound_id": compound_id,
        "compound_name": intake.compound_name,
        "eligibility": intake.eligibility,
        "eligibility_reason": intake.eligibility_reason,
        "context_snapshot": intake.context_snapshot,
        "counsel_summary": intake.counsel_summary,
        "consent": bool(intake.consent),
    }
    res = supabase.table("trial_intakes").insert(row).execute()
    saved = res.data[0] if res.data else {}
    return {"id": saved.get("id"), "status": saved.get("status", "submitted")}


def list_intakes(limit: int = 100) -> list[dict]:
    """List intakes, most recent first, for the coordinator queue."""
    return (
        supabase.table("trial_intakes")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )


# =============================================================== labs: upload


def _extract_pdf_text(data: bytes) -> str:
    """Extract concatenated page text from a PDF byte string (best-effort)."""
    try:
        import pypdf  # imported lazily so the module boots without the dep
    except ImportError:
        logger.error("consult: pypdf is not installed; cannot extract lab PDF text")
        return ""
    import io

    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
    except Exception:  # noqa: BLE001 - a corrupt/encrypted PDF must not 500 the endpoint
        logger.warning("consult: could not parse uploaded PDF", exc_info=True)
        return ""
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _claude_json(prompt: str, max_tokens: int = 1200) -> str | None:
    """Call Anthropic (same pattern as summaries.py) and return the raw text block."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        logger.warning("consult: ANTHROPIC_API_KEY not set; skipping biomarker extraction")
        return None
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=45,
        )
        if resp.status_code != 200:
            logger.error("consult: Anthropic returned %s: %s", resp.status_code, resp.text[:500])
            return None
        blocks = resp.json().get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
        return text or None
    except (httpx.HTTPError, ValueError, KeyError):
        logger.error("consult: Anthropic transport/parse error", exc_info=True)
        return None


def _coerce_labs(raw: object) -> list[LabValue]:
    """Coerce a parsed JSON payload of biomarker dicts into LabValue models."""
    items: list[dict] = []
    if isinstance(raw, list):
        items = [r for r in raw if isinstance(r, dict)]
    elif isinstance(raw, dict):
        for value in raw.values():
            if isinstance(value, list):
                items = [r for r in value if isinstance(r, dict)]
                break
    labs: list[LabValue] = []
    for item in items:
        name = item.get("name") or item.get("marker") or item.get("slug")
        if not name:
            continue
        labs.append(
            LabValue(
                name=str(name),
                slug=item.get("slug"),
                value=item.get("value"),
                unit=item.get("unit"),
                flag=item.get("flag"),
                status=item.get("status"),
                ref_low=_as_float(item.get("ref_low")),
                ref_high=_as_float(item.get("ref_high")),
            )
        )
    return labs


def _as_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def extract_biomarkers(text: str) -> list[LabValue]:
    """Extract biomarkers from lab-report text via Anthropic. [] on empty/failure."""
    if not text.strip():
        return []
    prompt = (
        "Extract every lab biomarker from this report as a JSON array. Each element must be an "
        'object with keys: name, value (number or string), unit, flag, status (one of '
        '"optimal", "high", "low", "abnormal"), ref_low (number), ref_high (number). Use null for '
        "anything absent. Return ONLY the JSON array, no prose, no markdown fences.\n\n"
        + text[:12000]
    )
    payload = _claude_json(prompt)
    if not payload:
        return []
    cleaned = payload.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        # drop an optional leading "json" language tag
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.error("consult: biomarker extraction did not return valid JSON")
        return []
    return _coerce_labs(parsed)


def upload_labs(user_ref: str, data: bytes) -> LabUploadResponse:
    """Extract biomarkers from a lab PDF and merge them onto the user's stored data."""
    text = _extract_pdf_text(data)
    labs = extract_biomarkers(text)
    patch = {
        "labs": [l.model_dump() for l in labs],
        "source": {
            "kind": "upload",
            "label": f"Lab PDF - {len(labs)} biomarkers",
            "at": _now_iso(),
        },
    }
    merged = user_data.save_user_data(user_ref, patch)
    return LabUploadResponse(
        connected=bool(merged.get("connected", True)),
        extracted_count=len(labs),
    )
