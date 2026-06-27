"""Tier-1 enrichment: turn the PubMed links cited on peptidecompared.com into
real, verified research-paper records by fetching metadata from NCBI itself.

Titles/journals/years come straight from the NCBI E-utilities API, so nothing is
fabricated. Papers are attributed to the compound whose page cited them
(curator-attributed — flagged via source='peptidecompared_cited').

Reads data/peptidecompared.json (produced by scrape_peptidecompared.py).
Emits idempotent SQL to stdout.

Usage:
    python3 scripts/scrape_peptidecompared.py > /dev/null   # ensure JSON exists
    python3 scripts/ingest_pubmed.py > papers.sql
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request

ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

# tokens that, if present in a paper title, confirm it is really about the compound
MATCH = {
    "BPC-157": ["bpc157", "bpc 157"], "TB-500": ["tb500", "thymosinbeta4", "thymosin beta 4"],
    "Ipamorelin": ["ipamorelin"], "CJC-1295": ["cjc1295", "cjc 1295"],
    "Thymosin alpha-1": ["thymosinalpha1", "thymalfasin", "zadaxin"],
    "Tesamorelin": ["tesamorelin", "egrifta"], "Melanotan II": ["melanotanii", "melanotan2"],
    "GHK-Cu": ["ghkcu", "ghk cu", "copper peptide", "copper tripeptide"],
    "Sermorelin": ["sermorelin", "geref"], "Semaglutide": ["semaglutide", "ozempic", "wegovy"],
    "Tirzepatide": ["tirzepatide", "mounjaro", "zepbound"], "Retatrutide": ["retatrutide", "ly3437943"],
}


def mentions(name: str, title: str) -> bool:
    norm = re.sub(r"[^a-z0-9]", "", title.lower())
    return any(re.sub(r"[^a-z0-9]", "", t) in norm for t in MATCH.get(name, [name.lower()]))


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


def pmid_of(url: str) -> str | None:
    m = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", url)
    return m.group(1) if m else None


def fetch_summaries(pmids: list[str]) -> dict:
    """Batch esummary; returns {pmid: {title, journal, year}}."""
    out = {}
    for i in range(0, len(pmids), 100):
        batch = pmids[i:i + 100]
        params = urllib.parse.urlencode({"db": "pubmed", "id": ",".join(batch), "retmode": "json"})
        data = get_json(f"{ESUMMARY}?{params}").get("result", {})
        for pmid in batch:
            rec = data.get(pmid)
            if not rec:
                continue
            year = None
            m = re.search(r"(\d{4})", rec.get("pubdate", ""))
            if m:
                year = int(m.group(1))
            out[pmid] = {
                "title": rec.get("title"),
                "journal": rec.get("fulljournalname") or rec.get("source"),
                "year": year,
            }
        time.sleep(0.4)  # NCBI: <=3 req/sec unauthenticated
    return out


def main() -> None:
    with open("data/peptidecompared.json") as fh:
        profiles = json.load(fh)

    # pmid -> set of compound names that cited it
    pmid_compounds: dict[str, set] = {}
    for p in profiles:
        for url in p.get("source_links", []):
            pmid = pmid_of(url)
            if pmid:
                pmid_compounds.setdefault(pmid, set()).add(p["name"])

    pmids = sorted(pmid_compounds)
    print(f"-- resolving {len(pmids)} unique PubMed IDs", file=sys.stderr)
    summaries = fetch_summaries(pmids)
    print(f"-- got metadata for {len(summaries)} papers", file=sys.stderr)

    print("-- research_papers: real PubMed metadata, cited on peptidecompared.com")
    rows = 0
    for pmid, names in pmid_compounds.items():
        meta = summaries.get(pmid)
        if not meta or not meta["title"]:
            continue
        for name in sorted(names):
            on_topic = "true" if mentions(name, meta["title"]) else "false"
            print(
                "insert into research_papers (compound_id, pmid, title, journal, year, url, source, title_mentions_compound) values ("
                f"(select id from compounds where name={sql_escape(name)}), {sql_escape(pmid)}, "
                f"{sql_escape(meta['title'])}, {sql_escape(meta['journal'])}, {sql_escape(meta['year'])}, "
                f"'https://pubmed.ncbi.nlm.nih.gov/{pmid}/', 'peptidecompared_cited', {on_topic}) "
                "on conflict (compound_id, pmid) do nothing;"
            )
            rows += 1
    print(f"-- emitted {rows} paper rows", file=sys.stderr)


if __name__ == "__main__":
    main()
