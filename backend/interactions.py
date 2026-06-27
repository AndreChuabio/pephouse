"""Drug-interaction lookup for the simulation builder.

Four layers, tried in order for each unordered compound pair:
  1. The `drug_interactions` Supabase table (curated/ingested rows).
  2. Live DrugBank DDI table via PubChem SDQ (`drugbankddi` collection). This
     mirrors the structured DrugBank Clinical DDI data for free; ~2.85M pair
     rows. Free, no auth, gated by per-pair 1-hour cache.
  3. Live openFDA `/drug/label.json` Section-7 prose lookup (FDA-approved
     compounds only). Catches cases the DrugBank mirror misses.
  4. A synthesized `source_kind='no_data'` row so the frontend can decide
     to hide the card honestly rather than surface fake "unknown" warnings.
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

OPENFDA_LABEL = "https://api.fda.gov/drug/label.json"
PUBCHEM_NAME_CID = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/cids/JSON"
PUBCHEM_SDQ = "https://pubchem.ncbi.nlm.nih.gov/sdq/sdqagent.cgi"
LIVE_TIMEOUT_S = 5
CACHE_TTL_S = 3600

# Aliases the openFDA search and the partner-name scan should know about.
# Kept tight — adding too many tokens causes false positives in label prose.
_ALIASES: dict[str, list[str]] = {
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

_LIVE_CACHE: dict[tuple[str, str, str], tuple[float, dict | None]] = {}
_CID_CACHE: dict[str, int | None] = {}


def _severity_from_descr(descr: str) -> str:
    """Crude severity heuristic on the DrugBank description text."""
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
    cache_key = ("drugbank", _norm(primary_name), _norm(partner_name))
    rev_key = ("drugbank", _norm(partner_name), _norm(primary_name))
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


def _key(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _aliases_for(name: str) -> list[str]:
    return _ALIASES.get(name, [name])


def _surrounding_sentence(prose: str, needle_names: list[str], limit: int = 280) -> str:
    lower = prose.lower()
    for name in needle_names:
        idx = lower.find(name.lower())
        if idx < 0:
            continue
        start = max(0, lower.rfind(".", 0, idx) + 1)
        end = lower.find(".", idx + len(name))
        if end == -1:
            end = min(len(prose), idx + limit)
        sentence = prose[start:end + 1].strip()
        if len(sentence) > limit:
            sentence = sentence[:limit].rstrip() + "…"
        return sentence
    return prose[:limit].strip() + ("…" if len(prose) > limit else "")


def _label_url(label: dict) -> str | None:
    set_id = label.get("set_id")
    if isinstance(set_id, list) and set_id:
        set_id = set_id[0]
    if not set_id:
        return None
    return f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}"


def _fetch_openfda(generic_name: str) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "search": f'openfda.generic_name:"{generic_name}" AND _exists_:drug_interactions',
            "limit": 3,
        }
    )
    req = urllib.request.Request(
        f"{OPENFDA_LABEL}?{params}",
        headers={"User-Agent": "pephouse/0.1"},
    )
    with urllib.request.urlopen(req, timeout=LIVE_TIMEOUT_S) as resp:
        return (json.load(resp) or {}).get("results", []) or []


def _live_lookup_pair(primary: dict, partner: dict) -> dict | None:
    """Try the openFDA Section-7 prose for `primary` and look for any
    `partner` alias inside it. Returns the dict body of an InteractionPair
    (without compound ids/names) on a hit, or None on a miss.
    """
    primary_name = primary.get("name", "")
    if not primary.get("approved"):
        return None  # only FDA-approved compounds have labels

    cache_key = ("openfda", _norm(primary_name), _norm(partner.get("name", "")))
    now = time.time()
    cached = _LIVE_CACHE.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL_S:
        return cached[1]

    result: dict | None = None
    try:
        partner_aliases = _aliases_for(partner.get("name", ""))
        partner_tokens_n = [_norm(t) for t in partner_aliases]
        for term in _aliases_for(primary_name):
            for label in _fetch_openfda(term):
                prose_parts = label.get("drug_interactions") or []
                if not prose_parts:
                    continue
                prose = " ".join(prose_parts) if isinstance(prose_parts, list) else str(prose_parts)
                prose_n = _norm(prose)
                if not any(tok and tok in prose_n for tok in partner_tokens_n):
                    continue
                result = {
                    "severity": "moderate",
                    "mechanism": _surrounding_sentence(prose, partner_aliases),
                    "management": None,
                    "source_url": _label_url(label),
                    "source_kind": "fda_label_live",
                }
                break
            if result is not None:
                break
    except Exception:
        result = None  # network / parse errors are silent — treated as no_data

    _LIVE_CACHE[cache_key] = (now, result)
    return result


def _no_data_pair(a_id: int, a_name: str, b_id: int, b_name: str) -> InteractionPair:
    return InteractionPair(
        compound_a_id=a_id,
        compound_a_name=a_name,
        compound_b_id=b_id,
        compound_b_name=b_name,
        severity="unknown",
        mechanism="No public DDI data covers this pair (research-compound territory).",
        management=None,
        source_url=None,
        source_kind="no_data",
    )


def build_interactions(compound_ids: list[int]) -> InteractionsResponse:
    """Pairwise interactions: curated DB rows -> live openFDA -> no_data."""
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
        a_row = compounds_by_id.get(a, {})
        b_row = compounds_by_id.get(b, {})
        a_name = a_row.get("name", f"compound {a}")
        b_name = b_row.get("name", f"compound {b}")

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

        # Try DrugBank-via-PubChem first (structured, severity-able), then
        # openFDA Section-7 prose as a secondary live source.
        live = (
            _live_lookup_drugbank(a_name, b_name)
            or _live_lookup_pair(a_row, b_row)
            or _live_lookup_pair(b_row, a_row)
        )
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
