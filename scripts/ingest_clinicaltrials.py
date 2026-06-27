"""Tier-1 ingestion: pull and VERIFY trials from ClinicalTrials.gov per compound.

A trial is kept only if the compound's name or a known alias literally appears
in the study's `interventions` field. The matched intervention string is stored
so every row is auditable. Non-matches are dropped and logged to stderr.

Emits idempotent SQL (INSERT ... ON CONFLICT (nct_id) DO NOTHING) to stdout.

Usage:
    python3 scripts/ingest_clinicaltrials.py > trials.sql 2> ingest_report.txt
    # then paste trials.sql into the Supabase SQL Editor and run

No DB credentials needed — this only reads the public CT.gov API and prints SQL.
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
MAX_CANDIDATES = 15  # candidates fetched per search term before verification

# Per compound: how to SEARCH ct.gov, and the tokens that must appear in an
# intervention name for the trial to count as truly about this compound.
COMPOUNDS = {
    "BPC-157":          {"search": ["BPC-157"],            "match": ["BPC-157", "BPC157", "Pentadecapeptide BPC 157", "PCO-02", "Bepecin"]},
    "TB-500":           {"search": ["Thymosin beta-4"],    "match": ["TB-500", "TB500", "Thymosin beta 4", "Thymosin beta-4", "RGN-352", "RGN-259"]},
    "Ipamorelin":       {"search": ["Ipamorelin"],         "match": ["Ipamorelin"]},
    "CJC-1295":         {"search": ["CJC-1295"],           "match": ["CJC-1295", "CJC1295", "CJC 1295"]},
    "Thymosin alpha-1": {"search": ["Thymalfasin"],        "match": ["Thymosin alpha 1", "Thymosin alpha-1", "Thymalfasin", "Zadaxin"]},
    "Tesamorelin":      {"search": ["Tesamorelin"],        "match": ["Tesamorelin", "Egrifta"]},
    "Melanotan II":     {"search": ["Melanotan II"],       "match": ["Melanotan II", "Melanotan-2", "MT-II", "MTII"]},
    "GHK-Cu":           {"search": ["GHK-Cu"],             "match": ["GHK-Cu", "GHK Cu", "GHK copper", "Copper tripeptide"]},
    "Sermorelin":       {"search": ["Sermorelin"],         "match": ["Sermorelin", "Geref"]},
    "Semaglutide":      {"search": ["Semaglutide"],        "match": ["Semaglutide", "Ozempic", "Wegovy", "Rybelsus"]},
    "Tirzepatide":      {"search": ["Tirzepatide"],        "match": ["Tirzepatide", "Mounjaro", "Zepbound"]},
    "Retatrutide":      {"search": ["Retatrutide"],        "match": ["Retatrutide", "LY3437943"]},
}


def norm(text: str) -> str:
    """Lowercase and strip everything but a-z0-9 for robust substring matching."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "pephouse/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def sql_escape(value) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def search_candidates(term: str) -> list[dict]:
    params = urllib.parse.urlencode({"query.intr": term, "pageSize": MAX_CANDIDATES, "format": "json"})
    return get_json(f"{LIST_API}?{params}").get("studies", [])


def interventions_of(study: dict, nct: str) -> list[str]:
    """Intervention names for a study; fetch the detail record if the list omits them."""
    arms = study.get("protocolSection", {}).get("armsInterventionsModule", {})
    names = [i.get("name", "") for i in arms.get("interventions", [])]
    if names:
        return names
    try:
        detail = get_json(DETAIL_API.format(nct=nct))
        arms = detail.get("protocolSection", {}).get("armsInterventionsModule", {})
        return [i.get("name", "") for i in arms.get("interventions", [])]
    except Exception:
        return []


def verify(study: dict, match_tokens: list[str]) -> tuple[bool, str | None]:
    """Return (kept, matched_intervention_name) — kept only on a real token hit."""
    p = study.get("protocolSection", {})
    nct = p.get("identificationModule", {}).get("nctId", "")
    norm_tokens = [norm(t) for t in match_tokens]
    for name in interventions_of(study, nct):
        ni = norm(name)
        if any(tok and tok in ni for tok in norm_tokens):
            return True, name
    return False, None


def extract(study: dict, matched_intervention: str) -> dict:
    p = study["protocolSection"]
    ident = p.get("identificationModule", {})
    design = p.get("designModule", {})
    conditions = p.get("conditionsModule", {}).get("conditions", [])
    nct_id = ident.get("nctId")
    return {
        "nct_id": nct_id,
        "phase": ", ".join(design.get("phases", [])) or None,
        "indication": ", ".join(conditions[:3]) or None,
        "status": p.get("statusModule", {}).get("overallStatus"),
        "n_enrolled": (design.get("enrollmentInfo") or {}).get("count"),
        "source_url": f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else None,
        "matched_intervention": matched_intervention,
    }


def main() -> None:
    print("-- Tier-1 trials, intervention-verified, from ClinicalTrials.gov")
    total_kept = total_dropped = 0
    for name, cfg in COMPOUNDS.items():
        kept_rows, dropped = [], []
        seen = set()
        for term in cfg["search"]:
            try:
                candidates = search_candidates(term)
            except Exception as exc:
                print(f"-- WARN search {name} ({term}): {exc}", file=sys.stderr)
                continue
            for study in candidates:
                nct = study.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
                if not nct or nct in seen:
                    continue
                seen.add(nct)
                ok, matched = verify(study, cfg["match"])
                if ok:
                    kept_rows.append(extract(study, matched))
                else:
                    dropped.append(nct)
                time.sleep(0.15)
        total_kept += len(kept_rows)
        total_dropped += len(dropped)
        print(f"\n-- {name}: kept {len(kept_rows)}, dropped {len(dropped)}")
        print(f"REPORT {name}: kept={len(kept_rows)} dropped={len(dropped)} dropped_ncts={dropped}", file=sys.stderr)
        for r in kept_rows:
            print(
                "insert into trials (compound_id, nct_id, phase, indication, status, "
                "n_enrolled, source_url, matched_intervention) values ("
                f"(select id from compounds where name={sql_escape(name)}), "
                f"{sql_escape(r['nct_id'])}, {sql_escape(r['phase'])}, "
                f"{sql_escape(r['indication'])}, {sql_escape(r['status'])}, "
                f"{sql_escape(r['n_enrolled'] if isinstance(r['n_enrolled'], int) else None)}, "
                f"{sql_escape(r['source_url'])}, {sql_escape(r['matched_intervention'])}) "
                "on conflict (nct_id) do nothing;"
            )
    print(f"\n-- TOTAL kept={total_kept} dropped={total_dropped}")
    print(f"REPORT TOTAL: kept={total_kept} dropped={total_dropped}", file=sys.stderr)


if __name__ == "__main__":
    main()
