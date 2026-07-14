"""Supabase data layer for the simulation builder (Arena 2).

This is intentionally separate from twin_engine.py: it only READS and shapes
registry data so the builder UI can render the evidence map, source tables, and
pick inputs WITHOUT running any Monte Carlo. Running the actual simulation is
still POST /simulate.

Tables that exist in the live DB but not in schema.sql (case_studies,
research_papers, sourcing, vendors, source_potency_priors) are fetched
defensively in db.py, so a missing table just yields an empty list.
"""

from __future__ import annotations

import db
from models import EvidenceSource, SimulationDataResponse


def _parse_int(text) -> int | None:
    if text is None or text == "":
        return None
    s = str(text).strip()
    return int(s) if s.lstrip("-").isdigit() else None


# A trial is evidence only once it has produced a result. Registering a study
# proves nothing: BPC-157 has two registered trials and zero completed ones, and
# counting those as trial-grade evidence made it read identically to a drug with
# finished Phase 3 outcomes. Melanotan II, CJC-1295 and GHK-Cu had the same
# problem. Status is therefore load-bearing, not decoration.
COMPLETED_TRIAL_STATUSES = frozenset({"COMPLETED"})


def completed_trials(trials: list[dict]) -> list[dict]:
    """The trials that actually finished and can be cited as evidence."""
    return [
        trial
        for trial in trials
        if str(trial.get("status") or "").strip().upper() in COMPLETED_TRIAL_STATUSES
    ]


def unfinished_trials(trials: list[dict]) -> list[dict]:
    """Registered trials with no result yet. Real information, but never evidence."""
    return [
        trial
        for trial in trials
        if str(trial.get("status") or "").strip().upper() not in COMPLETED_TRIAL_STATUSES
    ]


def _evidence_sources(tables: dict[str, list[dict]]) -> list[EvidenceSource]:
    """Map DB tiers to the evidence-map rows (4 strongest .. 1 weakest).

    The top rung counts only COMPLETED trials plus the outcome priors derived from
    them. An in-progress trial does not raise a compound's evidence tier.
    """
    trials = tables.get("trials", [])
    rct = len(completed_trials(trials)) + len(tables.get("outcome_priors", []))
    observational = len(tables.get("research_papers", []))
    quality = len(tables.get("vendor_lab_results", [])) + len(tables.get("sourcing", []))
    anecdote = len(tables.get("anecdotes", []))
    rows = [
        ("rct", "Clinical RCTs (Published)", "tier1_evidence", 4, rct),
        ("observational", "Observational / Papers", "tier1_evidence", 3, observational),
        ("quality", "Verified Real-world / Lab Data", "tier2_quality", 2, quality),
        ("anecdote", "Anecdotal / Forums", "tier3_anecdote", 1, anecdote),
    ]
    return [
        EvidenceSource(
            id=sid,
            label=label,
            data_tier=data_tier,
            display_tier=display_tier,
            count=count,
            available=count > 0,
        )
        for sid, label, data_tier, display_tier, count in rows
    ]


def _studied_age_range(priors: list[dict]) -> tuple[int | None, int | None]:
    mins = [m for m in (_parse_int(p.get("min_age")) for p in priors) if m is not None]
    maxs = [m for m in (_parse_int(p.get("max_age")) for p in priors) if m is not None]
    return (min(mins) if mins else None, max(maxs) if maxs else None)


def build_simulation_data(compound_id: int) -> SimulationDataResponse | None:
    """Assemble the full Supabase bundle (all related rows) for one compound."""
    compound = db.get_compound(compound_id)
    if compound is None:
        return None

    tables = db.get_compound_tables(compound_id)
    tables["vendors"] = db.get_vendors()

    priors = tables.get("outcome_priors", [])
    age_min, age_max = _studied_age_range(priors)

    return SimulationDataResponse(
        compound_id=compound_id,
        name=compound.get("name", ""),
        drug_class=compound.get("drug_class"),
        fda_status=compound.get("fda_status"),
        approved=bool(compound.get("approved")),
        summary=compound.get("summary"),
        evidence_sources=_evidence_sources(tables),
        outcome_names=sorted({p["outcome_name"] for p in priors if p.get("outcome_name")}),
        studied_age_min=age_min,
        studied_age_max=age_max,
        cohort_total=db.get_cohort_total(),
        tables=tables,
    )
