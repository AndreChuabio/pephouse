"""Build drug_interactions SQL from openFDA labels + curated peptide YAML.

Two passes:

1. FDA pass — for each FDA-approved compound in our registry, GET
   https://api.fda.gov/drug/label.json?search=openfda.generic_name:"X" AND
   _exists_:drug_interactions and parse Section 7 free-text. For every other
   registry compound name (or known alias) found in that prose, emit a row
   with severity='moderate' (label-mentioned default) and the label URL.

2. Curated pass — read scripts/peptide_interactions.yaml. Every entry must
   carry source_url OR source_kind='no_data', enforced by the loader.

Emits idempotent SQL on stdout (INSERT ... ON CONFLICT DO NOTHING). Pipe to
a file and paste into the Supabase SQL Editor, same flow as
ingest_clinicaltrials.py.

Usage:
    python3 scripts/ingest_drug_interactions.py > interactions.sql

No DB credentials needed — only reads the public FDA API and the local YAML.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

LABEL_API = "https://api.fda.gov/drug/label.json"
PEPTIDE_YAML = Path(__file__).parent / "peptide_interactions.yaml"

# Compounds we know are FDA-approved with retrievable labels.
FDA_COMPOUNDS = {
    "Semaglutide": ["Semaglutide", "Ozempic", "Wegovy", "Rybelsus"],
    "Tirzepatide": ["Tirzepatide", "Mounjaro", "Zepbound"],
    "Tesamorelin": ["Tesamorelin", "Egrifta"],
}

# Compounds (FDA + research peptides) that might appear in another drug's label.
REGISTRY_COMPOUNDS = {
    "Semaglutide": ["Semaglutide", "Ozempic", "Wegovy", "Rybelsus"],
    "Tirzepatide": ["Tirzepatide", "Mounjaro", "Zepbound"],
    "Retatrutide": ["Retatrutide", "LY3437943"],
    "Tesamorelin": ["Tesamorelin", "Egrifta"],
    "CJC-1295": ["CJC-1295", "CJC1295"],
    "Sermorelin": ["Sermorelin", "Geref"],
    "Ipamorelin": ["Ipamorelin"],
    "Thymosin alpha-1": ["Thymosin alpha 1", "Thymalfasin", "Zadaxin"],
    "TB-500": ["TB-500", "TB500", "Thymosin beta 4"],
    "BPC-157": ["BPC-157", "BPC157"],
    "Melanotan II": ["Melanotan II", "Melanotan-2", "MT-II"],
    "GHK-Cu": ["GHK-Cu", "Copper tripeptide"],
}


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "pephouse/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def sql_escape(value) -> str:
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def fetch_label(query: str) -> list[dict]:
    params = urllib.parse.urlencode({"search": query, "limit": 5})
    try:
        return get_json(f"{LABEL_API}?{params}").get("results", [])
    except Exception as exc:
        print(f"-- WARN fetch_label({query}): {exc}", file=sys.stderr)
        return []


def fda_label_url(label: dict) -> str | None:
    set_id = (label.get("set_id") or [None])[0] if isinstance(label.get("set_id"), list) else label.get("set_id")
    if not set_id:
        return None
    return f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}"


def find_mentions(prose: str, registry_norm: dict[str, list[str]]) -> set[str]:
    """Which registry compounds appear in this label prose? Returns canonical names."""
    n = norm(prose)
    hits: set[str] = set()
    for canonical, tokens in registry_norm.items():
        for tok in tokens:
            if tok and tok in n:
                hits.add(canonical)
                break
    return hits


def excerpt(prose: str, partner_names: list[str], limit: int = 280) -> str:
    """Pull the nearest sentence around any partner name. Falls back to head of prose."""
    lower = prose.lower()
    for name in partner_names:
        idx = lower.find(name.lower())
        if idx < 0:
            continue
        # Walk to the surrounding sentence
        start = max(0, lower.rfind(".", 0, idx) + 1)
        end = lower.find(".", idx + len(name))
        if end == -1:
            end = min(len(prose), idx + limit)
        sentence = prose[start:end + 1].strip()
        if len(sentence) > limit:
            sentence = sentence[:limit].rstrip() + "…"
        return sentence
    return prose[:limit].strip() + ("…" if len(prose) > limit else "")


def emit_insert(
    primary: str,
    partner: str,
    severity: str,
    mechanism: str,
    management: str | None,
    source_url: str | None,
    source_kind: str,
) -> str:
    a_sub = f"(select id from compounds where name={sql_escape(primary)})"
    b_sub = f"(select id from compounds where name={sql_escape(partner)})"
    return (
        "insert into drug_interactions "
        "(compound_a_id, compound_b_id, severity, mechanism, management, source_url, source_kind) "
        "select least(a,b), greatest(a,b), "
        f"{sql_escape(severity)}, {sql_escape(mechanism)}, {sql_escape(management)}, "
        f"{sql_escape(source_url)}, {sql_escape(source_kind)} "
        f"from ({a_sub} a, {b_sub} b) "
        "on conflict (compound_a_id, compound_b_id, source_kind) do nothing;"
    )


def fda_pass() -> int:
    """Pull real FDA Section 7 prose for each approved compound; emit rows for partner mentions."""
    registry_norm = {
        canonical: [norm(t) for t in tokens]
        for canonical, tokens in REGISTRY_COMPOUNDS.items()
    }
    total = 0
    print("\n-- FDA pass: openFDA /drug/label.json Section 7 mentions")
    for primary, search_terms in FDA_COMPOUNDS.items():
        seen_partners: set[str] = set()
        for term in search_terms:
            query = f'openfda.generic_name:"{term}" AND _exists_:drug_interactions'
            labels = fetch_label(query)
            for label in labels:
                prose_parts = label.get("drug_interactions") or []
                if not prose_parts:
                    continue
                prose = " ".join(prose_parts) if isinstance(prose_parts, list) else str(prose_parts)
                url = fda_label_url(label)
                partners = find_mentions(prose, registry_norm)
                partners.discard(primary)
                for partner in partners:
                    if partner in seen_partners:
                        continue
                    seen_partners.add(partner)
                    mech = excerpt(prose, REGISTRY_COMPOUNDS[partner])
                    print(emit_insert(primary, partner, "moderate", mech, None, url, "fda_label"))
                    total += 1
            time.sleep(0.2)
        print(
            f"-- {primary}: {len(seen_partners)} partner mentions found in FDA labels",
            file=sys.stderr,
        )
    return total


def curated_pass() -> int:
    if not PEPTIDE_YAML.exists():
        print(f"-- skip curated pass: {PEPTIDE_YAML} not found", file=sys.stderr)
        return 0
    try:
        import yaml  # type: ignore
    except ImportError:
        print("-- skip curated pass: install pyyaml to enable", file=sys.stderr)
        return 0
    data = yaml.safe_load(PEPTIDE_YAML.read_text()) or {}
    pairs = data.get("pairs") or []
    total = 0
    print("\n-- Curated pass: hand-cited peptide rules")
    for entry in pairs:
        required = ("compound_a", "compound_b", "severity", "source_kind")
        if any(k not in entry for k in required):
            print(f"-- WARN curated row missing fields: {entry}", file=sys.stderr)
            continue
        source_url = entry.get("source_url")
        source_kind = entry["source_kind"]
        if source_kind != "no_data" and not source_url:
            print(
                f"-- WARN refusing uncited curated row: {entry['compound_a']} x {entry['compound_b']}",
                file=sys.stderr,
            )
            continue
        print(
            emit_insert(
                entry["compound_a"],
                entry["compound_b"],
                entry["severity"],
                entry.get("mechanism") or "",
                entry.get("management"),
                source_url,
                source_kind,
            )
        )
        total += 1
    print(f"-- curated rows emitted: {total}", file=sys.stderr)
    return total


def main() -> None:
    print("-- Generated by scripts/ingest_drug_interactions.py")
    print(f"-- {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    fda = fda_pass()
    curated = curated_pass()
    print(f"\n-- TOTAL emitted: {fda + curated} ({fda} from FDA labels, {curated} curated)")
    print(f"REPORT TOTAL: fda={fda} curated={curated}", file=sys.stderr)


if __name__ == "__main__":
    main()
