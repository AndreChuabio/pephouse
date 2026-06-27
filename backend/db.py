"""Supabase client for the pephouse registry.

Uses the service_role key, so this must only ever run server-side.
The frontend talks to Supabase directly with the anon key instead.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def get_compounds() -> list[dict]:
    """Return all compounds in the registry."""
    return supabase.table("compounds").select("*").order("name").execute().data


def get_compound(compound_id: int) -> dict | None:
    """Return one compound by id, or None if it does not exist."""
    rows = supabase.table("compounds").select("*").eq("id", compound_id).execute().data
    return rows[0] if rows else None


def get_evidence(compound_id: int) -> dict:
    """Return the Tier-1 evidence bundle the grader is allowed to cite.

    Only tier1 rows are returned, so anecdote can never leak in as evidence.
    """
    trials = (
        supabase.table("trials")
        .select("*")
        .eq("compound_id", compound_id)
        .eq("tier", "tier1_evidence")
        .execute()
        .data
    )
    facts = (
        supabase.table("evidence_facts")
        .select("*")
        .eq("compound_id", compound_id)
        .eq("tier", "tier1_evidence")
        .execute()
        .data
    )
    return {"trials": trials, "facts": facts}


def get_outcome_priors(compound_id: int) -> list[dict]:
    """Return the Tier-1 effect-size priors that feed the twin's Monte Carlo."""
    return (
        supabase.table("outcome_priors")
        .select("*")
        .eq("compound_id", compound_id)
        .execute()
        .data
    )


def get_case_studies(compound_id: int) -> list[dict]:
    """Return evidence clusters for routing trial vs anecdote paths."""
    return (
        supabase.table("case_studies")
        .select("*")
        .eq("compound_id", compound_id)
        .execute()
        .data
    )


def get_synthetic_patients() -> list[dict]:
    """Return Tier-4 Synthea bodies from Supabase."""
    return supabase.table("synthetic_patients").select("*").execute().data


def get_source_potency_prior(source_type: str, compound_id: int) -> dict | None:
    """Resolve the Tier-2 source-quality prior for the SOURCE variance axis.

    Resolution order: compound-specific override (source_type, compound_id) ->
    source_type default (compound_id is NULL). Returns None if the source is unknown.
    """
    rows = (
        supabase.table("source_potency_priors")
        .select("*")
        .eq("source_type", source_type)
        .or_(f"compound_id.eq.{compound_id},compound_id.is.null")
        .execute()
        .data
    )
    if not rows:
        return None
    specific = [r for r in rows if r.get("compound_id") == compound_id]
    return specific[0] if specific else rows[0]


def get_anecdotes(compound_id: int, limit: int = 5) -> list[dict]:
    """Return Tier-3 anecdotes for cohort-miss fallback (context only)."""
    return (
        supabase.table("anecdotes")
        .select("permalink,claimed_effect,sentiment")
        .eq("compound_id", compound_id)
        .limit(limit)
        .execute()
        .data
    )


# Every per-compound table we expose in the /data bundle. Some (case_studies,
# research_papers, sourcing, vendors, source_potency_priors) exist in the live DB
# but not in schema.sql, so fetches are defensive — a missing table is skipped.
COMPOUND_TABLES = (
    "trials",
    "evidence_facts",
    "outcome_priors",
    "case_studies",
    "research_papers",
    "vendor_lab_results",
    "sourcing",
    "source_potency_priors",
    "anecdotes",
)


def fetch_table_for_compound(table: str, compound_id: int) -> list[dict]:
    """Return all rows of `table` for one compound, or [] if the table is absent."""
    try:
        return (
            supabase.table(table)
            .select("*")
            .eq("compound_id", compound_id)
            .execute()
            .data
        )
    except Exception:
        return []


def get_compound_tables(compound_id: int) -> dict[str, list[dict]]:
    """Pull every per-compound evidence/data table (defensively) for the bundle."""
    return {t: fetch_table_for_compound(t, compound_id) for t in COMPOUND_TABLES}


def get_vendors() -> list[dict]:
    """Vendor catalog (not compound-specific). Defensive: [] if table is absent."""
    try:
        return supabase.table("vendors").select("*").order("name").execute().data
    except Exception:
        return []


def get_cohort_total() -> int:
    """Total Tier-4 synthetic bodies available (not compound-specific)."""
    res = supabase.table("synthetic_patients").select("id", count="exact").execute()
    if res.count is not None:
        return res.count
    return len(res.data or [])
