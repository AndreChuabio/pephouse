"""Synthea Generic Modules, generated from outcome_priors and persisted to Supabase.

A Generic Module is the JSON state machine the Synthea Module Builder produces
(Initial -> Eligibility Guard -> Encounter -> Apply_Effect -> Terminal). We build
one per (compound, outcome) from the Tier-1 priors, store it in synthea_modules
mapped to compound_id, and the live cohort generator can load the active module so
generation is compound-specific instead of a vanilla Massachusetts cohort.

The module applies a COARSE effect range; the precise N(mean,SD) draw stays in the
Monte Carlo (Synthea can't sample a Gaussian).
"""

from __future__ import annotations

import re

from db import supabase


def _slug(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")


def _age_conditions(min_age, max_age) -> list[dict]:
    conds = []
    if min_age is not None and str(min_age).isdigit():
        conds.append({"condition_type": "Age", "operator": ">=", "quantity": int(min_age), "unit": "years"})
    if max_age is not None and str(max_age).isdigit():
        conds.append({"condition_type": "Age", "operator": "<=", "quantity": int(max_age), "unit": "years"})
    return conds


def build_module(compound_name: str, prior: dict) -> dict:
    """Build a Synthea Generic Module dict from one outcome prior."""
    mean = float(prior["effect_mean"])
    sd = float(prior["effect_sd"] or 0)
    name = f"Peptide - {compound_name} - {prior['outcome_name']}"
    return {
        "name": name,
        "remarks": [
            f"Auto-generated from outcome_priors. Source: {prior.get('source_nct')}.",
            f"Effect {prior['outcome_name']}: mean {mean} {prior.get('unit', '')} (SD {sd}, n={prior.get('population_n')}).",
            "Effect applied as a COARSE range; precise N(mean,SD) draw lives in the Monte Carlo.",
        ],
        "states": {
            "Initial": {"type": "Initial", "direct_transition": "Eligibility"},
            "Eligibility": {
                "type": "Guard",
                "allow": {
                    "condition_type": "And",
                    "conditions": _age_conditions(prior.get("min_age"), prior.get("max_age"))
                    or [{"condition_type": "Age", "operator": ">=", "quantity": 18, "unit": "years"}],
                },
                "direct_transition": "Treatment_Encounter",
            },
            "Treatment_Encounter": {
                "type": "Encounter", "encounter_class": "ambulatory", "reason": "",
                "codes": [{"system": "SNOMED-CT", "code": "185349003", "display": "Encounter for check up"}],
                "direct_transition": "Apply_Effect",
            },
            "Apply_Effect": {
                "type": "Observation", "category": "vital-signs", "unit": prior.get("unit", "%"),
                "codes": [{"system": "LOINC", "code": "00000-0", "display": f"{prior['outcome_name']} (peptide effect)"}],
                "range": {"low": round(mean - 2 * sd, 2), "high": round(mean + 2 * sd, 2)},
                "direct_transition": "Terminal",
            },
            "Terminal": {"type": "Terminal"},
        },
    }


def generate_and_save(compound_id: int) -> list[dict]:
    """Build + persist a Synthea module per outcome prior for the compound."""
    comp = supabase.table("compounds").select("name").eq("id", compound_id).execute().data
    if not comp:
        return []
    compound_name = comp[0]["name"]
    priors = supabase.table("outcome_priors").select("*").eq("compound_id", compound_id).execute().data

    saved = []
    for p in priors:
        module = build_module(compound_name, p)
        record = {
            "compound_id": compound_id,
            "name": module["name"],
            "outcome_name": p.get("outcome_name"),
            "module": module,
            "eligibility": {"min_age": p.get("min_age"), "max_age": p.get("max_age"), "sex": p.get("sex")},
            "source": "generated",
            "active": True,
        }
        try:
            res = supabase.table("synthea_modules").insert(record).execute()
            if res.data:
                saved.append(res.data[0])
        except Exception:
            continue
    return saved


def get_recent_modules(compound_id: int | None = None, limit: int = 20) -> list[dict]:
    """Recent modules (lightweight columns), optionally filtered to one compound."""
    try:
        q = (
            supabase.table("synthea_modules")
            .select("id,created_at,compound_id,name,outcome_name,eligibility,source,active")
            .order("created_at", desc=True)
            .limit(limit)
        )
        if compound_id is not None:
            q = q.eq("compound_id", compound_id)
        return q.execute().data
    except Exception:
        return []


def get_module(module_id: int) -> dict | None:
    """Full module record (incl. the JSON state machine) by id."""
    try:
        rows = supabase.table("synthea_modules").select("*").eq("id", module_id).execute().data
        return rows[0] if rows else None
    except Exception:
        return None


def get_active_module(compound_id: int) -> dict | None:
    """The most recent active module JSON for a compound, for live generation."""
    try:
        rows = (
            supabase.table("synthea_modules")
            .select("module")
            .eq("compound_id", compound_id)
            .eq("active", True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
        )
        return rows[0]["module"] if rows else None
    except Exception:
        return None
