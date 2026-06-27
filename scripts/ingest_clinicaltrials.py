"""Tier-1 ingestion: pull real trials from ClinicalTrials.gov for each compound.

Emits idempotent SQL (INSERT ... ON CONFLICT (nct_id) DO NOTHING) to stdout.

Usage:
    python3 scripts/ingest_clinicaltrials.py > trials.sql
    # then paste trials.sql into the Supabase SQL Editor and run

No DB credentials needed — this only reads the public CT.gov API and prints SQL.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request

API = "https://clinicaltrials.gov/api/v2/studies"

# Must match names already in the compounds table (the spine).
COMPOUNDS = [
    "BPC-157", "TB-500", "Ipamorelin", "CJC-1295", "Thymosin alpha-1",
    "Tesamorelin", "Melanotan II", "GHK-Cu", "Sermorelin",
    "Semaglutide", "Tirzepatide", "Retatrutide",
]

# CT.gov intervention search term per compound (some need the generic/scientific name).
SEARCH_TERM = {
    "TB-500": "Thymosin beta-4",
    "Thymosin alpha-1": "Thymalfasin",
    "Melanotan II": "Melanotan",
}

MAX_TRIALS_PER_COMPOUND = 10


def sql_escape(value: str | None) -> str:
    """Return a SQL string literal, or NULL, with single quotes escaped."""
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def fetch_trials(term: str) -> list[dict]:
    """Query CT.gov v2 for interventional studies of `term`."""
    params = urllib.parse.urlencode({
        "query.intr": term,
        "pageSize": MAX_TRIALS_PER_COMPOUND,
        "format": "json",
    })
    req = urllib.request.Request(f"{API}?{params}", headers={"User-Agent": "pephouse/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp).get("studies", [])


def extract(study: dict) -> dict:
    """Pull the fields the registry cares about from one CT.gov study record."""
    p = study["protocolSection"]
    ident = p.get("identificationModule", {})
    status = p.get("statusModule", {})
    design = p.get("designModule", {})
    conditions = p.get("conditionsModule", {}).get("conditions", [])
    nct_id = ident.get("nctId")
    return {
        "nct_id": nct_id,
        "phase": ", ".join(design.get("phases", [])) or None,
        "indication": ", ".join(conditions[:3]) or None,
        "status": status.get("overallStatus"),
        "n_enrolled": (design.get("enrollmentInfo") or {}).get("count"),
        "source_url": f"https://clinicaltrials.gov/study/{nct_id}" if nct_id else None,
    }


def main() -> None:
    print("-- Tier-1 trials ingested from ClinicalTrials.gov")
    for name in COMPOUNDS:
        term = SEARCH_TERM.get(name, name)
        try:
            studies = fetch_trials(term)
        except Exception as exc:  # network/parse errors should not kill the whole run
            print(f"-- WARN {name}: {exc}", file=sys.stderr)
            continue
        rows = [extract(s) for s in studies if s.get("protocolSection")]
        print(f"\n-- {name}: {len(rows)} trials")
        for r in rows:
            if not r["nct_id"]:
                continue
            n = r["n_enrolled"] if isinstance(r["n_enrolled"], int) else "NULL"
            print(
                "insert into trials (compound_id, nct_id, phase, indication, status, "
                "n_enrolled, source_url) values ("
                f"(select id from compounds where name={sql_escape(name)}), "
                f"{sql_escape(r['nct_id'])}, {sql_escape(r['phase'])}, "
                f"{sql_escape(r['indication'])}, {sql_escape(r['status'])}, "
                f"{n}, {sql_escape(r['source_url'])}) "
                "on conflict (nct_id) do nothing;"
            )
        time.sleep(0.3)  # be polite to the API


if __name__ == "__main__":
    main()
