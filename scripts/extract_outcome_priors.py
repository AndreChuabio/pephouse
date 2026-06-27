"""Tier-1 outcome extraction: pull real reported outcome measures + eligibility
from ClinicalTrials.gov results sections, for the trial-rich compounds.

Every row carries the real measured value, its dispersion (SD/SE as reported),
the arm, the per-arm n, the timeframe, and the verifying intervention string.
Nothing is computed or invented here — these are the numbers CT.gov posted.

Emits idempotent SQL for a `trial_outcomes` staging table. From there, curated
`outcome_priors` (the sim's seed distributions) are promoted by hand/review.

Usage:
    python3 scripts/extract_outcome_priors.py > outcomes.sql 2> outcomes_report.txt
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request

LIST_API = "https://clinicaltrials.gov/api/v2/studies"
DETAIL_API = "https://clinicaltrials.gov/api/v2/studies/{nct}"
MAX_TRIALS = 6  # results-bearing trials to pull per compound

# trial-rich compounds worth seeding (others stay anecdote-only for now)
COMPOUNDS = {
    "Semaglutide": ["Semaglutide", "Ozempic", "Wegovy"],
    "Tirzepatide": ["Tirzepatide", "Mounjaro", "Zepbound"],
    "Retatrutide": ["Retatrutide", "LY3437943"],
    "Tesamorelin": ["Tesamorelin", "Egrifta"],
    "TB-500": ["TB-500", "Thymosin beta 4", "RGN-259"],
    "Thymosin alpha-1": ["Thymosin alpha 1", "Thymalfasin", "Zadaxin"],
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "pephouse/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def sql(value) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def results_trials(term: str) -> list[str]:
    """NCT ids of results-bearing interventional trials for `term`."""
    params = urllib.parse.urlencode({
        "query.intr": term, "aggFilters": "results:with", "pageSize": MAX_TRIALS, "format": "json",
    })
    data = get_json(f"{LIST_API}?{params}")
    out = []
    for s in data.get("studies", []):
        nct = s.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
        if nct:
            out.append(nct)
    return out


def verify_intervention(detail: dict, tokens: list[str]) -> str | None:
    arms = detail.get("protocolSection", {}).get("armsInterventionsModule", {})
    ntok = [norm(t) for t in tokens]
    for iv in arms.get("interventions", []):
        ni = norm(iv.get("name", ""))
        if any(t and t in ni for t in ntok):
            return iv.get("name")
    return None


def group_sizes(om: dict) -> dict:
    """Map groupId -> n from the outcome measure's denoms, if present."""
    sizes = {}
    for denom in om.get("denoms", []):
        for c in denom.get("counts", []):
            gid, val = c.get("groupId"), c.get("value")
            if gid and val and str(val).isdigit():
                sizes[gid] = int(val)
    return sizes


def main() -> None:
    print("-- trial_outcomes: real reported outcome measures from CT.gov results sections")
    total = 0
    for name, tokens in COMPOUNDS.items():
        seen, rows = set(), 0
        for term in tokens:
            try:
                ncts = results_trials(term)
            except Exception as exc:
                print(f"-- WARN search {name}/{term}: {exc}", file=sys.stderr)
                continue
            for nct in ncts:
                if nct in seen:
                    continue
                seen.add(nct)
                try:
                    detail = get_json(DETAIL_API.format(nct=nct))
                except Exception as exc:
                    print(f"-- WARN detail {nct}: {exc}", file=sys.stderr)
                    continue
                matched = verify_intervention(detail, tokens)
                if not matched:
                    continue
                elig = detail.get("protocolSection", {}).get("eligibilityModule", {})
                min_age = elig.get("minimumAge")
                max_age = elig.get("maximumAge")
                sex = elig.get("sex")
                oms = detail.get("resultsSection", {}).get("outcomeMeasuresModule", {}).get("outcomeMeasures", [])
                for om in oms:
                    if om.get("type") != "PRIMARY":
                        continue
                    sizes = group_sizes(om)
                    groups = {g.get("id"): g.get("title") for g in om.get("groups", [])}
                    for cls in om.get("classes", []):
                        for cat in cls.get("categories", []):
                            for m in cat.get("measurements", []):
                                gid = m.get("groupId")
                                val = m.get("value")
                                if val is None:
                                    continue
                                print(
                                    "insert into trial_outcomes (compound_id, nct_id, measure_title, "
                                    "measure_type, unit, time_frame, param_type, dispersion_type, "
                                    "group_title, group_n, value, spread, min_age, max_age, sex, "
                                    "source_url, matched_intervention) values ("
                                    f"(select id from compounds where name={sql(name)}), {sql(nct)}, "
                                    f"{sql(om.get('title'))}, 'PRIMARY', {sql(om.get('unitOfMeasure'))}, "
                                    f"{sql((om.get('timeFrame') or '')[:120])}, {sql(om.get('paramType'))}, "
                                    f"{sql(om.get('dispersionType'))}, {sql(groups.get(gid))}, "
                                    f"{sql(sizes.get(gid))}, {sql(_num(val))}, {sql(_num(m.get('spread')))}, "
                                    f"{sql(min_age)}, {sql(max_age)}, {sql(sex)}, "
                                    f"'https://clinicaltrials.gov/study/{nct}', {sql(matched)}) "
                                    "on conflict (nct_id, measure_title, group_title) do nothing;"
                                )
                                rows += 1
                time.sleep(0.2)
        total += rows
        print(f"REPORT {name}: {rows} outcome rows from {len(seen)} trials", file=sys.stderr)
    print(f"REPORT TOTAL: {total} outcome rows", file=sys.stderr)


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    main()
