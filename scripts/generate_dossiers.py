"""Generate one named evidence dossier (Markdown) per compound for the Tavus CVI Knowledge Base.

Pulls the full Supabase bundle from the live backend's ``GET /compounds/{id}/data``
endpoint and renders a human-readable dossier per compound. The file names are chosen
so that Tavus ``rag.observability`` citation events render legibly on screen
(for example "BPC-157 evidence dossier"), which is the on-screen proof of the
no-hallucination thesis in the Consult demo.

Output: ``scripts/dossiers/<slug> evidence dossier.md``, one per compound.

Usage:
    python3 scripts/generate_dossiers.py
    python3 scripts/generate_dossiers.py --api-base http://localhost:8000
    python3 scripts/generate_dossiers.py --only 1,3

Only reads public catalog data; no secrets required.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("generate_dossiers")

DEFAULT_API_BASE = "https://pephouse-backend-production.up.railway.app"
OUTPUT_DIR = Path(__file__).resolve().parent / "dossiers"

# Tables that carry vector embeddings we must not dump into a text dossier.
_DROP_FIELDS = {"embedding"}

# Ordered rendering of the nested tables, with a readable heading for each.
_TABLE_SECTIONS: list[tuple[str, str]] = [
    ("trials", "Registered human trials"),
    ("evidence_facts", "Tier-graded evidence facts"),
    ("research_papers", "Research papers"),
    ("case_studies", "Case studies"),
    ("outcome_priors", "Outcome priors (simulation inputs)"),
    ("anecdotes", "Community anecdotes (lowest tier)"),
    ("sourcing", "Sourcing reality"),
    ("vendors", "Vendors"),
    ("vendor_lab_results", "Vendor lab results"),
    ("source_potency_priors", "Source potency priors"),
]


def _fetch_json(url: str) -> Any:
    """Fetch and decode a JSON document, raising on transport or HTTP error."""
    import json

    try:
        with urlopen(url, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} fetching {url}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error fetching {url}: {exc.reason}") from exc


def _slug(name: str) -> str:
    """Filesystem- and citation-friendly slug that preserves the compound name."""
    cleaned = re.sub(r"[^\w\s-]", "", name).strip()
    return re.sub(r"\s+", "-", cleaned)


def _fmt_value(value: Any) -> str:
    """Render a single cell value as compact Markdown-safe text."""
    if value is None or value == "":
        return "-"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (list, dict)):
        import json

        return f"`{json.dumps(value, ensure_ascii=False)}`"
    return str(value).replace("\n", " ").strip()


def _render_rows(rows: list[dict[str, Any]]) -> list[str]:
    """Render a list of record dicts as a sequence of Markdown definition blocks."""
    lines: list[str] = []
    for idx, row in enumerate(rows, start=1):
        fields = {k: v for k, v in row.items() if k not in _DROP_FIELDS}
        lines.append(f"**{idx}.**")
        for key, value in fields.items():
            lines.append(f"- {key}: {_fmt_value(value)}")
        lines.append("")
    return lines


def render_dossier(data: dict[str, Any]) -> str:
    """Render the full Markdown dossier for one compound's ``/data`` bundle."""
    name = data.get("name", "Unknown compound")
    lines: list[str] = [
        f"# {name} evidence dossier",
        "",
        "Source: PepHouse evidence registry (synthetic and public-literature derived). "
        "Education, not medical advice.",
        "",
        "## Overview",
        f"- Compound id: {_fmt_value(data.get('compound_id'))}",
        f"- Drug class: {_fmt_value(data.get('drug_class'))}",
        f"- FDA status: {_fmt_value(data.get('fda_status'))}",
        f"- Approved: {_fmt_value(data.get('approved'))}",
        f"- Cohort total (registered trial enrollment): {_fmt_value(data.get('cohort_total'))}",
        f"- Studied age range: {_fmt_value(data.get('studied_age_min'))} to "
        f"{_fmt_value(data.get('studied_age_max'))}",
        "",
        f"Summary: {_fmt_value(data.get('summary'))}",
        "",
    ]

    sources = data.get("evidence_sources") or []
    if sources:
        lines.append("## Evidence tiers available")
        for src in sources:
            avail = "available" if src.get("available") else "none"
            lines.append(
                f"- {src.get('label', src.get('id'))} "
                f"(tier {src.get('display_tier')}): {src.get('count')} items, {avail}"
            )
        lines.append("")

    tables = data.get("tables") or {}
    for key, heading in _TABLE_SECTIONS:
        rows = tables.get(key) or []
        if not rows:
            continue
        lines.append(f"## {heading}")
        lines.extend(_render_rows(rows))

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="Backend base URL")
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated compound ids to generate (default: all)",
    )
    parser.add_argument(
        "--out-dir",
        default=str(OUTPUT_DIR),
        help="Directory to write dossiers into",
    )
    args = parser.parse_args()

    api_base = args.api_base.rstrip("/")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Fetching compound catalog from %s", api_base)
    compounds = _fetch_json(f"{api_base}/compounds")

    wanted: set[int] | None = None
    if args.only.strip():
        wanted = {int(x) for x in args.only.split(",") if x.strip()}

    written = 0
    for compound in compounds:
        cid = compound["id"]
        if wanted is not None and cid not in wanted:
            continue
        try:
            data = _fetch_json(f"{api_base}/compounds/{cid}/data")
        except RuntimeError as exc:
            logger.error("Skipping compound %s: %s", cid, exc)
            continue

        markdown = render_dossier(data)
        filename = f"{_slug(data.get('name', str(cid)))} evidence dossier.md"
        (out_dir / filename).write_text(markdown, encoding="utf-8")
        logger.info("Wrote %s (%d chars)", filename, len(markdown))
        written += 1

    logger.info("Done. %d dossiers in %s", written, out_dir)
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
