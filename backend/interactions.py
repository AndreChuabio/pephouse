"""Drug-interaction lookup for the simulation builder.

Three layers, tried in order for each unordered compound pair:
  1. The `drug_interactions` Supabase table (curated rows, if any).
  2. Live DrugBank DDI table via PubChem SDQ (`drugbankddi` collection).
     ~2.85M pair rows, free, no auth, gated by per-pair 1-hour cache.
  3. A synthesized `source_kind='no_data'` row so the frontend can decide
     to render an honest empty-state banner rather than surface fake
     "unknown" warnings.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from itertools import combinations

import db
from models import InteractionPair, InteractionsResponse

PUBCHEM_NAME_CID = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/cids/JSON"
PUBCHEM_SDQ = "https://pubchem.ncbi.nlm.nih.gov/sdq/sdqagent.cgi"
LIVE_TIMEOUT_S = 5
CACHE_TTL_S = 3600

_LIVE_CACHE: dict[tuple[str, str], tuple[float, dict | None]] = {}
_CID_CACHE: dict[str, int | None] = {}


def _key(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _severity_from_descr(descr: str) -> str:
    s = descr.lower()
    if any(t in s for t in ("fatal", "death", "life-threatening", "severe")):
        return "major"
    if any(t in s for t in ("increased", "increases", "decreased efficacy", "may decrease")):
        return "moderate"
    if any(t in s for t in ("may", "can be")):
        return "minor"
    return "unknown"


def _resolve_cid(name: str) -> int | None:
    key = _norm(name)
    if key in _CID_CACHE:
        return _CID_CACHE[key]
    cid: int | None = None
    try:
        url = PUBCHEM_NAME_CID.format(name=urllib.parse.quote(name))
        req = urllib.request.Request(url, headers={"User-Agent": "pephouse/0.1"})
        with urllib.request.urlopen(req, timeout=LIVE_TIMEOUT_S) as resp:
            data = json.load(resp)
        cids = (data.get("IdentifierList") or {}).get("CID") or []
        if cids:
            cid = int(cids[0])
    except Exception:
        cid = None
    _CID_CACHE[key] = cid
    return cid


def _live_lookup_drugbank(primary_name: str, partner_name: str) -> dict | None:
    """PubChem SDQ → DrugBank `drugbankddi` collection. Returns the body of
    an InteractionPair (minus ids/names) on a hit, or None on a miss.
    Symmetric: tries primary's CID first, then partner's, since SDQ rows are
    one-directional.
    """
    cache_key = (_norm(primary_name), _norm(partner_name))
    rev_key = (_norm(partner_name), _norm(primary_name))
    now = time.time()
    for key in (cache_key, rev_key):
        cached = _LIVE_CACHE.get(key)
        if cached and now - cached[0] < CACHE_TTL_S:
            return cached[1]

    primary_cid = _resolve_cid(primary_name)
    partner_cid = _resolve_cid(partner_name)
    if not primary_cid or not partner_cid:
        _LIVE_CACHE[cache_key] = (now, None)
        return None

    partner_n = _norm(partner_name)
    primary_n = _norm(primary_name)

    def _query(anchor_cid: int) -> list[dict]:
        body = json.dumps(
            {
                "select": "name2,descr,dbid,dbid2,cid,cid2",
                "collection": "drugbankddi",
                "where": {"ands": [{"cid": str(anchor_cid)}]},
                "limit": 5000,
            }
        )
        url = f"{PUBCHEM_SDQ}?infmt=json&outfmt=json&query={urllib.parse.quote(body)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pephouse/0.1"})
            with urllib.request.urlopen(req, timeout=LIVE_TIMEOUT_S) as resp:
                data = json.load(resp)
            return data.get("SDQOutputSet", [{}])[0].get("rows") or []
        except Exception:
            return []

    for anchor_cid, target_n in ((primary_cid, partner_n), (partner_cid, primary_n)):
        for row in _query(anchor_cid):
            if _norm(row.get("name2") or "") != target_n:
                continue
            descr = row.get("descr") or ""
            dbid2 = row.get("dbid2") or ""
            result = {
                "severity": _severity_from_descr(descr),
                "mechanism": descr,
                "management": None,
                "source_url": f"https://go.drugbank.com/drugs/{dbid2}" if dbid2 else None,
                "source_kind": "drugbank_pubchem",
            }
            _LIVE_CACHE[cache_key] = (now, result)
            return result

    _LIVE_CACHE[cache_key] = (now, None)
    return None


def _no_data_pair(a_id: int, a_name: str, b_id: int, b_name: str) -> InteractionPair:
    return InteractionPair(
        compound_a_id=a_id,
        compound_a_name=a_name,
        compound_b_id=b_id,
        compound_b_name=b_name,
        severity="unknown",
        mechanism="No public DDI data covers this pair.",
        management=None,
        source_url=None,
        source_kind="no_data",
    )


def build_interactions(compound_ids: list[int]) -> InteractionsResponse:
    """Pairwise interactions: curated DB rows -> DrugBank live -> no_data."""
    unique_ids = sorted(set(compound_ids))
    if len(unique_ids) < 2:
        return InteractionsResponse(pairs=[])

    compounds_by_id = db.get_compounds_by_ids(unique_ids)
    rows = db.fetch_drug_interactions(unique_ids)

    documented: dict[tuple[int, int], list[dict]] = {}
    for row in rows:
        a = row.get("compound_a_id")
        b = row.get("compound_b_id")
        if a is None or b is None:
            continue
        if a not in compounds_by_id or b not in compounds_by_id:
            continue
        documented.setdefault(_key(a, b), []).append(row)

    pairs: list[InteractionPair] = []
    for a, b in combinations(unique_ids, 2):
        key = _key(a, b)
        a_name = compounds_by_id.get(a, {}).get("name", f"compound {a}")
        b_name = compounds_by_id.get(b, {}).get("name", f"compound {b}")

        if key in documented:
            for row in documented[key]:
                ra = row.get("compound_a_id", a)
                rb = row.get("compound_b_id", b)
                pairs.append(
                    InteractionPair(
                        compound_a_id=ra,
                        compound_a_name=compounds_by_id.get(ra, {}).get("name", f"compound {ra}"),
                        compound_b_id=rb,
                        compound_b_name=compounds_by_id.get(rb, {}).get("name", f"compound {rb}"),
                        severity=row.get("severity") or "unknown",
                        mechanism=row.get("mechanism"),
                        management=row.get("management"),
                        source_url=row.get("source_url"),
                        source_kind=row.get("source_kind") or "curated",
                    )
                )
            continue

        live = _live_lookup_drugbank(a_name, b_name)
        if live is not None:
            pairs.append(
                InteractionPair(
                    compound_a_id=a,
                    compound_a_name=a_name,
                    compound_b_id=b,
                    compound_b_name=b_name,
                    severity=live["severity"],
                    mechanism=live["mechanism"],
                    management=live["management"],
                    source_url=live["source_url"],
                    source_kind=live["source_kind"],
                )
            )
            continue

        pairs.append(_no_data_pair(a, a_name, b, b_name))

    return InteractionsResponse(pairs=pairs)
