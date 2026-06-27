"""Persist each /simulate run to Supabase so it is retrievable by id and listable
as 'recent'. Stores the inputs, the live-generated cohort, and the result summary.
Best-effort: a save failure never breaks a simulation.
"""

from __future__ import annotations

from db import supabase


def save_run(
    *,
    compound_id: int | None,
    patient: dict,
    source_type: str | None,
    n_draws: int,
    live_cohort: bool,
    cohort_source: str,
    cohort_n: int,
    cohort_gen_ms: int | None,
    data_confidence: str,
    outcomes: list[dict],
    cohort: list[dict] | None,
) -> int | None:
    """Insert one run record; return its id (None on failure)."""
    record = {
        "compound_id": compound_id,
        "patient": patient,
        "source_type": source_type,
        "n_draws": n_draws,
        "live_cohort": live_cohort,
        "cohort_source": cohort_source,
        "cohort_n": cohort_n,
        "cohort_gen_ms": cohort_gen_ms,
        "data_confidence": data_confidence,
        "outcomes": outcomes,
        "cohort": cohort,  # only the live-generated bodies; null for pre-loaded runs
    }
    try:
        res = supabase.table("simulation_runs").insert(record).execute()
        return res.data[0]["id"] if res.data else None
    except Exception:
        return None


def get_recent_runs(limit: int = 20) -> list[dict]:
    """Most-recent runs first (lightweight columns for a list view)."""
    try:
        return (
            supabase.table("simulation_runs")
            .select(
                "id,created_at,compound_id,source_type,live_cohort,"
                "cohort_source,cohort_n,cohort_gen_ms,data_confidence,outcomes"
            )
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
        )
    except Exception:
        return []


def get_run(run_id: int) -> dict | None:
    """Full run record (incl. the saved cohort) by id."""
    try:
        rows = supabase.table("simulation_runs").select("*").eq("id", run_id).execute().data
        return rows[0] if rows else None
    except Exception:
        return None
