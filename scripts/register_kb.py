"""Register the PepHouse evidence dossiers with the Tavus knowledge base.

For each dossier under ``scripts/dossiers`` this script:

1. POSTs ``https://tavusapi.com/v2/documents`` with a public ``document_url``
   pointing at the backend dossier route, so Tavus ingests the markdown by URL.
2. PATCHes the consult PAL to tag it with ``pephouse-evidence`` at the root-level
   ``document_tags`` field, which is what a conversation's ``document_tags`` filter
   selects on. (A ``layers.llm.tools`` patch with string ids returns 500, so the
   root-level tag is used instead.)
3. Regenerates ``frontend/src/data/dossierTiers.ts`` -- a typed map from
   ``document_name`` to the dossier's top available evidence tier and descriptor --
   so the Sources panel badges cited dossiers from registry facts rather than a
   fragile document-name heuristic.

The Tavus API key is read from ``backend/.env`` (never printed). The public base
URL defaults to the Railway backend. Run only once the backend is publicly
reachable at ``<base>/consult/dossiers/<slug>``.

Usage:
    python scripts/register_kb.py --base https://pephouse-backend-production.up.railway.app
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys

import httpx

logger = logging.getLogger("pephouse.register_kb")

TAVUS_HOST = "https://tavusapi.com"
DEFAULT_BASE = "https://pephouse-backend-production.up.railway.app"
DEFAULT_PAL_ID = "p237120fd76e"
DOCUMENT_TAG = "pephouse-evidence"
DOSSIER_SUFFIX = " evidence dossier.md"

_HERE = os.path.dirname(os.path.abspath(__file__))
DOSSIER_DIR = os.path.join(_HERE, "dossiers")
TIERS_TS_PATH = os.path.join(
    os.path.dirname(_HERE), "frontend", "src", "data", "dossierTiers.ts"
)
ENV_PATH = os.path.join(os.path.dirname(_HERE), "backend", ".env")

# Matches a tier-availability line, e.g.
# "- Clinical RCTs (Published) (tier 4): 2 items, available".
_TIER_LINE = re.compile(r"\(tier\s*(\d)\):\s*(\d+)\s*items?,\s*(available|none)", re.IGNORECASE)
_COMPOUND_ID = re.compile(r"^-?\s*Compound id:\s*(\d+)", re.IGNORECASE | re.MULTILINE)
_SUMMARY = re.compile(r"^Summary:\s*(.+)$", re.IGNORECASE | re.MULTILINE)


class Dossier:
    """Parsed metadata for a single evidence dossier."""

    def __init__(self, compound: str, filename: str, text: str) -> None:
        self.compound = compound
        self.filename = filename
        self.slug = compound.lower()
        self.document_name = f"{compound} evidence dossier"

        cid = _COMPOUND_ID.search(text)
        self.compound_id = int(cid.group(1)) if cid else 0

        summary = _SUMMARY.search(text)
        self.descriptor = summary.group(1).strip() if summary else self.document_name

        self.level = self._top_available_tier(text)

    @staticmethod
    def _top_available_tier(text: str) -> int:
        """Return the highest tier number with available items (1 when none)."""
        available = [
            int(tier)
            for tier, count, state in _TIER_LINE.findall(text)
            if state.lower() == "available" and int(count) > 0
        ]
        return max(available) if available else 1

    def document_url(self, base: str) -> str:
        """Public URL the Tavus knowledge base fetches this dossier from."""
        return f"{base.rstrip('/')}/consult/dossiers/{self.slug}"


def read_api_key(env_path: str) -> str:
    """Read TAVUS_API_KEY from a dotenv file without importing dependencies.

    Raises RuntimeError (never prints the value) when the key is absent.
    """
    if not os.path.isfile(env_path):
        raise RuntimeError(f"env file not found at {env_path}")
    with open(env_path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() == "TAVUS_API_KEY":
                return value.strip().strip('"').strip("'")
    raise RuntimeError(f"TAVUS_API_KEY not present in {env_path}")


def load_dossiers(dossier_dir: str) -> list[Dossier]:
    """Parse every dossier in ``dossier_dir`` sorted by compound id."""
    if not os.path.isdir(dossier_dir):
        raise RuntimeError(f"dossier directory not found at {dossier_dir}")
    dossiers: list[Dossier] = []
    for fname in sorted(os.listdir(dossier_dir)):
        if not fname.endswith(DOSSIER_SUFFIX):
            continue
        compound = fname[: -len(DOSSIER_SUFFIX)]
        with open(os.path.join(dossier_dir, fname), "r", encoding="utf-8") as handle:
            text = handle.read()
        dossiers.append(Dossier(compound, fname, text))
    dossiers.sort(key=lambda d: d.compound_id)
    logger.info("loaded %d dossiers from %s", len(dossiers), dossier_dir)
    return dossiers


def _ts_string(value: str) -> str:
    """Escape a Python string for embedding in a double-quoted TS string literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def write_dossier_tiers(dossiers: list[Dossier], ts_path: str) -> None:
    """Regenerate the typed document_name -> tier map consumed by the Sources panel."""
    header = (
        "// Auto-generated by scripts/register_kb.py. Do not edit by hand.\n"
        "//\n"
        "// Maps a Tavus knowledge-base document_name to the compound's top available\n"
        "// evidence tier and a short descriptor, so the Sources panel can badge a cited\n"
        "// dossier from registry facts rather than a fragile document-name heuristic.\n"
        "// The level is the highest tier with available items in that dossier\n"
        "// (4 = published RCT ... 1 = anecdote); the descriptor is the dossier summary.\n\n"
        "export interface DossierTierEntry {\n"
        "  /** Registry compound id. */\n"
        "  compoundId: number;\n"
        "  /** Highest evidence tier with available items (4 = RCT ... 1 = anecdote). */\n"
        "  level: 1 | 2 | 3 | 4;\n"
        "  /** One-line evidence characterization for the Sources panel. */\n"
        "  descriptor: string;\n"
        "}\n\n"
        "export const dossierTiers: Record<string, DossierTierEntry> = {\n"
    )
    entries = []
    for d in dossiers:
        entries.append(
            f'  "{_ts_string(d.document_name)}": {{\n'
            f"    compoundId: {d.compound_id},\n"
            f"    level: {d.level},\n"
            f'    descriptor: "{_ts_string(d.descriptor)}",\n'
            f"  }},\n"
        )
    content = header + "".join(entries) + "};\n"
    os.makedirs(os.path.dirname(ts_path), exist_ok=True)
    with open(ts_path, "w", encoding="utf-8") as handle:
        handle.write(content)
    logger.info("wrote %s (%d entries)", ts_path, len(dossiers))


def register_documents(
    client: httpx.Client, dossiers: list[Dossier], base: str
) -> int:
    """POST each dossier to the Tavus documents endpoint. Returns the success count."""
    registered = 0
    for d in dossiers:
        body = {
            "document_url": d.document_url(base),
            "document_name": d.document_name,
            "tags": [DOCUMENT_TAG],
        }
        try:
            resp = client.post(f"{TAVUS_HOST}/v2/documents", json=body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "document register failed for %s (%s): %s",
                d.document_name,
                exc.response.status_code,
                exc.response.text[:300],
            )
            continue
        except httpx.HTTPError:
            logger.error("document register transport error for %s", d.document_name, exc_info=True)
            continue
        registered += 1
        logger.info("registered %s -> %s", d.document_name, d.document_url(base))
    return registered


def tag_persona(client: httpx.Client, pal_id: str) -> bool:
    """PATCH the PAL to set root-level document_tags to [pephouse-evidence].

    Uses a JSON Patch ``add`` (which sets or replaces the object member) on
    ``/document_tags``. Returns True on success.
    """
    patch = [{"op": "add", "path": "/document_tags", "value": [DOCUMENT_TAG]}]
    try:
        resp = client.patch(f"{TAVUS_HOST}/v2/personas/{pal_id}", json=patch)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "persona tag failed for %s (%s): %s",
            pal_id,
            exc.response.status_code,
            exc.response.text[:300],
        )
        return False
    except httpx.HTTPError:
        logger.error("persona tag transport error for %s", pal_id, exc_info=True)
        return False
    logger.info("tagged persona %s with document_tags=[%s]", pal_id, DOCUMENT_TAG)
    return True


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        default=DEFAULT_BASE,
        help="Public base URL of the backend serving /consult/dossiers/<slug>.",
    )
    parser.add_argument(
        "--pal",
        default=DEFAULT_PAL_ID,
        help="Tavus PAL (persona) id to tag with the evidence documents.",
    )
    parser.add_argument(
        "--env",
        default=ENV_PATH,
        help="Path to the dotenv file holding TAVUS_API_KEY.",
    )
    parser.add_argument(
        "--skip-remote",
        action="store_true",
        help="Only regenerate dossierTiers.ts; do not call the Tavus API.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Entry point: regenerate the tier map, then register documents and tag the PAL."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = parse_args(argv)

    dossiers = load_dossiers(DOSSIER_DIR)
    if not dossiers:
        logger.error("no dossiers found; nothing to register")
        return 1

    write_dossier_tiers(dossiers, TIERS_TS_PATH)

    if args.skip_remote:
        logger.info("--skip-remote set; skipped Tavus API calls")
        return 0

    key = read_api_key(args.env)
    headers = {"x-api-key": key, "content-type": "application/json"}
    with httpx.Client(timeout=30, headers=headers) as client:
        registered = register_documents(client, dossiers, args.base)
        tagged = tag_persona(client, args.pal)

    logger.info("done: %d/%d documents registered, persona tagged=%s", registered, len(dossiers), tagged)
    return 0 if registered == len(dossiers) and tagged else 2


if __name__ == "__main__":
    sys.exit(main())
