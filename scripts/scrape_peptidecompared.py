"""Tier: SECONDARY/EDITORIAL ingestion from peptidecompared.com.

This is a curated review site, NOT a primary source. Its content is stored in
its own `editorial_profiles` table and must NEVER be cited by the grader as
evidence. Use it for UI context, the benefit taxonomy, and as a pointer to the
primary study links it cites (which can be followed into Tier 1).

Outputs two things:
  - data/peptidecompared.json  : human-readable scraped profiles (open and read it)
  - stdout                     : idempotent SQL to load editorial_profiles

Usage:
    python3 scripts/scrape_peptidecompared.py > editorial.sql
    # read data/peptidecompared.json, then paste editorial.sql into Supabase
"""

from __future__ import annotations

import html as htmllib
import json
import os
import re
import sys
import time
import urllib.request

BASE = "https://peptidecompared.com/peptides/"

# their slug -> our canonical compound name (must match the compounds table)
SLUGS = {
    "bpc-157": "BPC-157", "tb-500": "TB-500", "ipamorelin": "Ipamorelin",
    "cjc-1295": "CJC-1295", "thymosin-alpha-1": "Thymosin alpha-1",
    "tesamorelin": "Tesamorelin", "melanotan-ii": "Melanotan II",
    "ghk-cu": "GHK-Cu", "sermorelin": "Sermorelin", "semaglutide": "Semaglutide",
    "tirzepatide": "Tirzepatide", "retatrutide": "Retatrutide",
}

# page section heading -> our field name
SECTION_FIELD = {
    "what is": "summary", "benefits": "benefits", "how it works": "mechanism",
    "dosing": "dosing", "side effects": "side_effects",
}
MAX_FIELD_CHARS = 2000


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 pephouse/0.1"})
    return urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "ignore")


def clean(fragment: str) -> str:
    fragment = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", fragment)
    text = htmllib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_page(html: str) -> dict:
    """Pull each h4 section's text plus the cited study count and source links."""
    record = {f: None for f in SECTION_FIELD.values()}
    record["research_count"] = None
    record["source_links"] = []

    heads = list(re.finditer(r"<h4[^>]*>(.*?)</h4>", html, re.S))
    for i, m in enumerate(heads):
        title = clean(m.group(1)).lower()
        start = m.end()
        end = heads[i + 1].start() if i + 1 < len(heads) else min(start + 6000, len(html))
        body_html = html[start:end]
        body = clean(body_html)[:MAX_FIELD_CHARS]
        for key, field in SECTION_FIELD.items():
            if key in title:
                record[field] = body or None
        if "research" in title:
            cnt = re.search(r"(\d+)\s+stud", title)
            record["research_count"] = int(cnt.group(1)) if cnt else None
            record["source_links"] = sorted(set(
                re.findall(r'href="(https?://(?:pubmed|www\.ncbi|clinicaltrials|doi)[^"]+)"', body_html)
            ))[:10]
    return record


def sql_escape(value) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    profiles = []
    for slug, name in SLUGS.items():
        try:
            html = fetch(BASE + slug)
        except Exception as exc:
            print(f"-- WARN {slug}: {exc}", file=sys.stderr)
            continue
        rec = parse_page(html)
        rec.update({"slug": slug, "name": name, "source_url": BASE + slug})
        profiles.append(rec)
        filled = [f for f in SECTION_FIELD.values() if rec.get(f)]
        print(f"-- {name}: fields={filled} studies={rec['research_count']} links={len(rec['source_links'])}", file=sys.stderr)
        time.sleep(0.3)

    # 1) human-readable JSON
    os.makedirs("data", exist_ok=True)
    with open("data/peptidecompared.json", "w") as fh:
        json.dump(profiles, fh, indent=2)
    print(f"-- wrote data/peptidecompared.json ({len(profiles)} profiles)", file=sys.stderr)

    # 2) SQL
    print("-- editorial_profiles from peptidecompared.com (SECONDARY content, never cited as evidence)")
    for r in profiles:
        links = r["source_links"]
        links_sql = ("ARRAY[" + ",".join(sql_escape(u) for u in links) + "]::text[]") if links else "NULL"
        print(
            "insert into editorial_profiles (compound_id, name, slug, summary, benefits, "
            "mechanism, dosing, side_effects, research_count, cited_source_links, source, source_url) values ("
            f"(select id from compounds where name={sql_escape(r['name'])}), "
            f"{sql_escape(r['name'])}, {sql_escape(r['slug'])}, {sql_escape(r['summary'])}, "
            f"{sql_escape(r['benefits'])}, {sql_escape(r['mechanism'])}, {sql_escape(r['dosing'])}, "
            f"{sql_escape(r['side_effects'])}, {sql_escape(r['research_count'])}, {links_sql}, "
            f"'peptidecompared', {sql_escape(r['source_url'])}) "
            "on conflict (slug) do nothing;"
        )


if __name__ == "__main__":
    main()
