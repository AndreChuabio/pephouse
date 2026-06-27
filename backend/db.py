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
