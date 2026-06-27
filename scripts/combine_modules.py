"""Combine N Synthea Generic Modules into one -- a deterministic graph merge, no LLM.

A Generic Module is a JSON state machine. Combining is pure data transformation:
  * one shared Initial + Eligibility Guard (the intersection / AND of every module's
    age/sex conditions -- the strictest gate wins),
  * each module's effect path (the states between Eligibility and Terminal) is
    namespaced (m0_, m1_, ...) and chained in sequence,
  * one shared Terminal.

So "trial + anecdote" = combine(trial_module, anecdote_module): an eligible patient
walks both effect paths in one run.

Usage:
    # from files
    python3 scripts/combine_modules.py a.json b.json -o combined.json
    # from Supabase: all modules for a compound id
    python3 scripts/combine_modules.py --compound 3 -o combined.json

--compound needs backend/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (text or "module").lower()).strip("_")


def _eligibility_conditions(modules: list[dict]) -> list[dict]:
    """Union (AND) of every module's eligibility conditions -- the strictest gate."""
    conditions: list[dict] = []
    for module in modules:
        guard = module.get("states", {}).get("Eligibility", {})
        for cond in guard.get("allow", {}).get("conditions", []):
            if cond not in conditions:
                conditions.append(cond)
    return conditions or [{"condition_type": "Age", "operator": ">=", "quantity": 18, "unit": "years"}]


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


def combine_modules(name: str, modules: list[dict]) -> dict:
    """Merge modules into one Generic Module. Deterministic; transitions are rewired
    to a single linear chain (overriding branching transitions in effect states)."""
    combined: dict[str, dict] = {"Initial": {"type": "Initial", "direct_transition": "Eligibility"}}

    sequence: list[tuple[str, dict]] = []
    for i, module in enumerate(modules):
        for state_name in _effect_chain(module):
            new_name = f"m{i}_{state_name}"
            sequence.append((new_name, copy.deepcopy(module["states"][state_name])))

    eligibility = {
        "type": "Guard",
        "allow": {"condition_type": "And", "conditions": _eligibility_conditions(modules)},
        "direct_transition": sequence[0][0] if sequence else "Terminal",
    }
    combined["Eligibility"] = eligibility

    for idx, (state_name, state) in enumerate(sequence):
        nxt = sequence[idx + 1][0] if idx + 1 < len(sequence) else "Terminal"
        for branch_key in ("conditional_transition", "distributed_transition", "complex_transition"):
            state.pop(branch_key, None)
        state["direct_transition"] = nxt
        combined[state_name] = state

    combined["Terminal"] = {"type": "Terminal"}
    return {
        "name": name,
        "remarks": [
            f"Combined from {len(modules)} module(s): " + ", ".join(m.get("name", "?") for m in modules) + ".",
            "Deterministic merge (scripts/combine_modules.py) -- shared eligibility, chained effects.",
        ],
        "states": combined,
    }


def _modules_for_compound(compound_id: int) -> tuple[str, list[dict]]:
    from dotenv import load_dotenv
    import os
    from supabase import create_client

    load_dotenv("backend/.env")
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    comp = sb.table("compounds").select("name").eq("id", compound_id).execute().data
    comp_name = comp[0]["name"] if comp else f"compound {compound_id}"
    rows = (
        sb.table("synthea_modules")
        .select("module")
        .eq("compound_id", compound_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return comp_name, [r["module"] for r in rows if r.get("module")]


def main() -> None:
    parser = argparse.ArgumentParser(description="Combine Synthea Generic Modules into one.")
    parser.add_argument("files", nargs="*", help="module JSON files to combine")
    parser.add_argument("--compound", type=int, help="combine all DB modules for this compound id")
    parser.add_argument("-o", "--out", help="output file (default: stdout)")
    parser.add_argument("-n", "--name", help="name for the combined module")
    args = parser.parse_args()

    if args.compound is not None:
        comp_name, modules = _modules_for_compound(args.compound)
        name = args.name or f"Peptide (combined) - {comp_name}"
    elif args.files:
        modules = [json.load(open(f)) for f in args.files]
        name = args.name or "Combined module"
    else:
        sys.exit("provide module files or --compound <id>")

    if not modules:
        sys.exit("no modules to combine")

    combined = combine_modules(name, modules)
    text = json.dumps(combined, indent=2)
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
        print(f"wrote {args.out} ({len(combined['states'])} states from {len(modules)} module(s))")
    else:
        print(text)


if __name__ == "__main__":
    main()
