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

import copy
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


def anecdote_band(anecdotes: list[dict]) -> tuple[int, int]:
    """A wide, ILLUSTRATIVE effect band (low, high) skewed by net sentiment.

    There is no numeric anecdote effect data; this is intentionally coarse + wide
    and is only ever used flagged as anecdotal / low-confidence.
    """
    sentiment: dict[str, int] = {}
    for a in anecdotes:
        key = (a.get("sentiment") or "unknown").lower()
        sentiment[key] = sentiment.get(key, 0) + 1
    pos, neg = sentiment.get("positive", 0), sentiment.get("negative", 0)
    if pos > neg:
        return -10, 30
    if neg > pos:
        return -30, 10
    return -25, 25


def anecdote_distribution(compound_id: int) -> tuple[float, float] | None:
    """Illustrative (mean, sd) for the anecdote tier, or None if no anecdotes."""
    anec = supabase.table("anecdotes").select("sentiment").eq("compound_id", compound_id).limit(50).execute().data
    if not anec:
        return None
    low, high = anecdote_band(anec)
    return (low + high) / 2.0, (high - low) / 4.0


def build_anecdote_module(compound_name: str, anecdotes: list[dict]) -> dict:
    """Build an ANECDOTE-derived module for a compound with no trial priors.

    Tier wall: this is flagged anecdotal, the effect band is illustrative (no numeric
    effect data exists), and it generates synthetic bodies only -- it never becomes an
    outcome_prior, so the twin's distribution for this compound stays distribution_void.
    """
    n = len(anecdotes)
    sentiment: dict[str, int] = {}
    for a in anecdotes:
        key = (a.get("sentiment") or "unknown").lower()
        sentiment[key] = sentiment.get(key, 0) + 1
    sent_summary = ", ".join(f"{v} {k}" for k, v in sorted(sentiment.items(), key=lambda kv: -kv[1]))
    claims = [a.get("claimed_effect") for a in anecdotes if a.get("claimed_effect")][:3]
    low, high = anecdote_band(anecdotes)

    return {
        "name": f"Peptide (anecdotal) - {compound_name} - self-reported response",
        "remarks": [
            f"ANECDOTE-DERIVED from {n} Reddit reports (sentiment: {sent_summary}). NOT trial evidence.",
            f"Example claims: {'; '.join(claims) if claims else 'n/a'}.",
            "Effect band is ILLUSTRATIVE (no numeric effect data) and intentionally wide / low-confidence.",
            "Tier wall: generates synthetic bodies only; never feeds the twin's outcome_priors.",
        ],
        "states": {
            "Initial": {"type": "Initial", "direct_transition": "Eligibility"},
            "Eligibility": {
                "type": "Guard",
                "allow": {"condition_type": "And", "conditions": [{"condition_type": "Age", "operator": ">=", "quantity": 18, "unit": "years"}]},
                "direct_transition": "Treatment_Encounter",
            },
            "Treatment_Encounter": {
                "type": "Encounter", "encounter_class": "ambulatory", "reason": "",
                "codes": [{"system": "SNOMED-CT", "code": "185349003", "display": "Encounter for check up"}],
                "direct_transition": "Apply_Effect",
            },
            "Apply_Effect": {
                "type": "Observation", "category": "survey", "unit": "%",
                "codes": [{"system": "LOINC", "code": "00000-0", "display": "self-reported response (anecdotal)"}],
                "range": {"low": low, "high": high},
                "direct_transition": "Terminal",
            },
            "Terminal": {"type": "Terminal"},
        },
    }


def generate_and_save(compound_id: int) -> list[dict]:
    """Build + persist Synthea modules for a compound.

    Trial-grounded compounds get one module per outcome prior (source=generated).
    Anecdote-only compounds get a single anecdote-derived module (source=anecdote),
    so every compound can have a module without breaching the tier wall.
    """
    comp = supabase.table("compounds").select("name").eq("id", compound_id).execute().data
    if not comp:
        return []
    compound_name = comp[0]["name"]
    priors = supabase.table("outcome_priors").select("*").eq("compound_id", compound_id).execute().data

    saved = []
    if priors:
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
            _insert(record, saved)
    else:
        anecdotes = (
            supabase.table("anecdotes")
            .select("sentiment,claimed_effect")
            .eq("compound_id", compound_id)
            .limit(50)
            .execute()
            .data
        )
        if anecdotes:
            module = build_anecdote_module(compound_name, anecdotes)
            record = {
                "compound_id": compound_id,
                "name": module["name"],
                "outcome_name": "self_reported_response",
                "module": module,
                "eligibility": {"min_age": 18, "max_age": None, "sex": None},
                "source": "anecdote",
                "active": True,
            }
            _insert(record, saved)
    return saved


def _insert(record: dict, saved: list[dict]) -> None:
    try:
        res = supabase.table("synthea_modules").insert(record).execute()
        if res.data:
            saved.append(res.data[0])
    except Exception:
        pass


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


def module_for(compound_id: int) -> dict | None:
    """The compound's active module, or one built in-memory from its priors/anecdotes
    (NOT persisted -- avoids polluting synthea_modules on every Arena run)."""
    active = get_active_module(compound_id)
    if active:
        return active
    comp = supabase.table("compounds").select("name").eq("id", compound_id).execute().data
    if not comp:
        return None
    name = comp[0]["name"]
    priors = supabase.table("outcome_priors").select("*").eq("compound_id", compound_id).execute().data
    if priors:
        return build_module(name, priors[0])
    anecdotes = supabase.table("anecdotes").select("sentiment,claimed_effect").eq("compound_id", compound_id).limit(50).execute().data
    if anecdotes:
        return build_anecdote_module(name, anecdotes)
    return None


def _effect_chain(module: dict) -> list[str]:
    """Ordered state names from after Eligibility up to (not including) Terminal."""
    states = module.get("states", {})
    chain: list[str] = []
    seen: set[str] = set()
    cur = states.get("Eligibility", {}).get("direct_transition")
    while cur and cur != "Terminal" and cur in states and cur not in seen:
        seen.add(cur)
        chain.append(cur)
        cur = states[cur].get("direct_transition")
    return chain


def _first_effect_state(module: dict) -> dict | None:
    """The module's Apply_Effect Observation (the effect range), if any."""
    states = module.get("states", {})
    for name in _effect_chain(module):
        if states.get(name, {}).get("type") == "Observation":
            return states[name]
    for state in states.values():
        if state.get("type") == "Observation":
            return state
    return None


def combine_modules(name: str, weighted_modules: list[tuple[dict, int]]) -> dict:
    """Pool N study/compound modules into one, matching synthea/example_combined.py:
    a shared Initial + Eligibility (AND of conditions) + Treatment_Encounter that
    distributed_transition fans out to each module's Observation branch, WEIGHTED by N
    (study-N / total-N), converging to Terminal. One study -> linear; many -> fan-out."""
    conditions: list[dict] = []
    for module, _ in weighted_modules:
        for cond in module.get("states", {}).get("Eligibility", {}).get("allow", {}).get("conditions", []):
            if cond not in conditions:
                conditions.append(cond)
    if not conditions:
        conditions = [{"condition_type": "Age", "operator": ">=", "quantity": 18, "unit": "years"}]

    states: dict[str, dict] = {
        "Initial": {"type": "Initial", "direct_transition": "Eligibility"},
        "Eligibility": {
            "type": "Guard",
            "allow": {"condition_type": "And", "conditions": conditions},
            "direct_transition": "Treatment_Encounter",
        },
        "Terminal": {"type": "Terminal"},
    }
    encounter: dict = {
        "type": "Encounter",
        "encounter_class": "ambulatory",
        "codes": [{"system": "SNOMED-CT", "code": "185349003", "display": "Encounter for check up"}],
    }

    branches: list[tuple[str, dict, int]] = []
    for i, (module, weight) in enumerate(weighted_modules):
        effect = _first_effect_state(module)
        state = copy.deepcopy(effect) if effect else {
            "type": "Observation", "category": "vital-signs", "unit": "%",
            "codes": [{"system": "LOINC", "code": "00000-0", "display": "effect"}],
            "range": {"low": -10, "high": 10},
        }
        for branch_key in ("conditional_transition", "distributed_transition", "complex_transition"):
            state.pop(branch_key, None)
        state["direct_transition"] = "Terminal"
        branches.append((f"Apply_m{i}", state, max(int(weight or 0), 1)))

    if len(branches) == 1:
        encounter["direct_transition"] = branches[0][0]
    else:
        total = sum(w for _, _, w in branches)
        encounter["distributed_transition"] = [
            {"distribution": round(w / total, 4), "transition": nm} for nm, _, w in branches
        ]
    states["Treatment_Encounter"] = encounter
    for nm, state, _ in branches:
        states[nm] = state

    return {
        "name": name,
        "remarks": [
            f"Pooled across {len(branches)} study/compound module(s), weighted by N.",
            "distributed_transition fan-out (modules.combine_modules; see synthea/example_combined.py).",
        ],
        "states": states,
    }


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
