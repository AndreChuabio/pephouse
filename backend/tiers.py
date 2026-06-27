"""Tier selection for /simulate.

The twin can draw on four data tiers; the user picks which to include and the
endpoint validates the choice, runs the right model, and reports exactly which
tiers were used + the confidence cost. Picking a weaker tier is always visible.

  trial     - Tier-1 outcome_priors (the biological Monte Carlo)
  quality   - Tier-2 source_potency_priors (the delivered-dose variance axis)
  anecdote  - Tier-3 anecdotes (illustrative band only, never trial evidence)
  synthetic - Tier-4 Synthea (live patient-matched cohort generation)
"""

from __future__ import annotations

import db

TIER_NAMES = ["trial", "quality", "anecdote", "synthetic"]

# Confidence ceiling per tier when it is the weakest one included.
TIER_CONFIDENCE_CAP = {"trial": 1.0, "quality": 0.85, "synthetic": 0.85, "anecdote": 0.35}


def availability(compound_id: int) -> dict:
    """Which tiers are available for this compound, with counts for the UI."""
    priors = db.get_outcome_priors(compound_id)
    anecdotes = (
        db.supabase.table("anecdotes").select("id").eq("compound_id", compound_id).limit(50).execute().data
    )
    return {
        "trial": {"available": bool(priors), "count": len(priors)},
        "quality": {"available": True, "count": None},      # gray-market source axis always applies
        "anecdote": {"available": bool(anecdotes), "count": len(anecdotes)},
        "synthetic": {"available": True, "count": None},     # Synthea live always available
    }


def resolve(requested: list[str] | None, avail: dict) -> tuple[list[str], list[str]]:
    """Return (used, notes). requested=None => default to trial when available."""
    if requested is None:
        return (["trial"] if avail["trial"]["available"] else []), []

    used: list[str] = []
    notes: list[str] = []
    for tier in requested:
        if tier not in TIER_NAMES:
            notes.append(f"unknown tier '{tier}' ignored")
            continue
        if tier in ("trial", "anecdote") and not avail[tier]["available"]:
            notes.append(f"{tier} unavailable for this compound — skipped")
            continue
        if tier not in used:
            used.append(tier)
    return used, notes


def confidence_cap(used: list[str]) -> float:
    """Confidence ceiling = the weakest included tier (anecdote drags it down)."""
    caps = [TIER_CONFIDENCE_CAP[t] for t in used if t in TIER_CONFIDENCE_CAP]
    return min(caps) if caps else 0.3
