"""The Supabase -> Synthea "connection": read outcome_priors and emit a Synthea
Generic Module JSON per compound. Drop the output in synthea/src/main/resources/
modules/ and run Synthea, or open it in the Module Builder to refine.

Synthea has no DB driver. It reads module JSON files; this script generates them
from our priors. The module encodes the eligibility gate + the patient path and
applies a COARSE effect (range = mean +/- 2*SD). The precise per-patient draw
should live in the Monte Carlo, not here — Synthea can't sample a Gaussian.

    python3 scripts/build_synthea_module.py            # writes ./synthea_modules/*.json

Needs backend/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
"""

from __future__ import annotations

import json
import os
import re

from dotenv import load_dotenv
from supabase import create_client

load_dotenv("backend/.env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

OUT_DIR = "synthea_modules"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def age_conditions(min_age, max_age) -> list[dict]:
    conds = []
    if min_age and str(min_age).isdigit():
        conds.append({"condition_type": "Age", "operator": ">=", "quantity": int(min_age), "unit": "years"})
    if max_age and str(max_age).isdigit():
        conds.append({"condition_type": "Age", "operator": "<=", "quantity": int(max_age), "unit": "years"})
    return conds


def build_module(compound: str, prior: dict) -> dict:
    mean = float(prior["effect_mean"])
    sd = float(prior["effect_sd"] or 0)
    name = f"Peptide - {compound} - {prior['outcome_name']}"
    return {
        "name": name,
        "remarks": [
            f"Auto-generated from outcome_priors. Source: {prior.get('source_nct')}.",
            f"Effect {prior['outcome_name']}: mean {mean} {prior.get('unit','')} (SD {sd}, n={prior.get('population_n')}).",
            "Effect applied as a COARSE range; do the precise N(mean,SD) draw in the Monte Carlo.",
        ],
        "states": {
            "Initial": {"type": "Initial", "direct_transition": "Eligibility"},
            "Eligibility": {
                "type": "Guard",
                "allow": {
                    "condition_type": "And",
                    "conditions": age_conditions(prior.get("min_age"), prior.get("max_age")) or
                                  [{"condition_type": "Age", "operator": ">=", "quantity": 18, "unit": "years"}],
                },
                "direct_transition": "Treatment_Encounter",
            },
            "Treatment_Encounter": {
                "type": "Encounter", "encounter_class": "ambulatory", "reason": "",
                "codes": [{"system": "SNOMED-CT", "code": "185349003", "display": "Encounter for check up"}],
                "direct_transition": "Apply_Effect",
            },
            "Apply_Effect": {
                "type": "Observation",
                "category": "vital-signs",
                "unit": prior.get("unit", "%"),
                "codes": [{"system": "LOINC", "code": "00000-0", "display": f"{prior['outcome_name']} (peptide effect)"}],
                "range": {"low": round(mean - 2 * sd, 2), "high": round(mean + 2 * sd, 2)},
                "direct_transition": "Terminal",
            },
            "Terminal": {"type": "Terminal"},
        },
    }


def main() -> None:
    priors = sb.table("outcome_priors").select("*, compounds(name)").execute().data
    os.makedirs(OUT_DIR, exist_ok=True)
    n = 0
    for p in priors:
        compound = (p.get("compounds") or {}).get("name", "unknown")
        module = build_module(compound, p)
        fname = os.path.join(OUT_DIR, f"peptide_{slug(compound)}_{slug(p['outcome_name'])}.json")
        with open(fname, "w") as fh:
            json.dump(module, fh, indent=2)
        n += 1
        print(f"wrote {fname}")
    print(f"\n{n} Synthea modules generated in {OUT_DIR}/ — drop into synthea/src/main/resources/modules/")


if __name__ == "__main__":
    main()
