"""Junction (formerly Vital) health-data integration — server only.

Ported from AndreChuabio/gohealthme (`app/lib/server/junction.ts`), adapted from
Next.js + wallet-address identity to FastAPI + a per-browser ``user_ref``.

Two import paths feed the Simulation Arena's patient profile:

  - connect a wearable  -> /v2/summary/profile + /v2/summary/body
  - pull bloodwork       -> /v3/order/{order_id}/result

Privacy invariant (same as the reference): the API key lives only in this
process; the browser never sees it. Raw samples never leave here — only a
derived ``ProfilePatch`` (age / sex / weight / conditions / a few biomarkers).

The pure mappers (``calc_age``, ``parse_profile``, ``parse_body``,
``parse_labs``, ``derive_conditions``) hold the honesty-relevant logic and are
unit-tested without network in ``test_junction.py``.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

load_dotenv()


# --------------------------------------------------------------------- config


def _api_key() -> str:
    key = os.environ.get("JUNCTION_API_KEY")
    if not key:
        raise RuntimeError("JUNCTION_API_KEY is not set (see backend/.env.example)")
    return key


def _base_url() -> str:
    return os.environ.get("JUNCTION_BASE_URL", "https://api.sandbox.tryvital.io")


def _link_env() -> tuple[str, str]:
    return (
        os.environ.get("JUNCTION_ENV", "sandbox"),
        os.environ.get("JUNCTION_REGION", "us"),
    )


def _headers() -> dict[str, str]:
    return {"x-vital-api-key": _api_key(), "content-type": "application/json"}


# A wide window so any sandbox sample is caught; summaries need a start_date.
_HISTORY_START = "2015-01-01"


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# =================================================================== mappers
# Pure, network-free, unit-tested. Keep all honesty logic here.


def calc_age(birth_date: str | None, today: date | None = None) -> int | None:
    """Whole years from an ISO ``birth_date`` (date or datetime). None if unparseable."""
    if not birth_date:
        return None
    ref = today or datetime.now(timezone.utc).date()
    try:
        born = date.fromisoformat(birth_date[:10])
    except ValueError:
        return None
    years = ref.year - born.year
    if (ref.month, ref.day) < (born.month, born.day):
        years -= 1
    return years


def _map_sex(value: str | None) -> str | None:
    """Junction gender/sex enum (female|male|other|unknown) -> the twin's M|F."""
    if not value:
        return None
    v = value.strip().lower()
    if v in ("male", "m"):
        return "M"
    if v in ("female", "f"):
        return "F"
    return None  # other / unknown -> omit, let the user's input stand


def parse_profile(profile: dict, today: date | None = None) -> dict:
    """Pull ``{age?, sex?}`` from a /v2/summary/profile payload."""
    out: dict = {}
    age = calc_age(profile.get("birth_date") or profile.get("date_of_birth"), today)
    if age is not None:
        out["age"] = age
    sex = _map_sex(profile.get("sex") or profile.get("gender"))
    if sex is not None:
        out["sex"] = sex
    return out


def _records(payload) -> list[dict]:
    """Junction summary payloads come as a bare list, ``{kind: [...]}`` or ``{data: [...]}``."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for v in payload.values():
            if isinstance(v, list):
                return v
    return []


def _day_key(rec: dict) -> str:
    return (rec.get("calendar_date") or rec.get("date") or "")[:10]


def parse_body(payload) -> dict:
    """Pull ``{weight_kg?}`` (most recent record's weight) from /v2/summary/body."""
    recs = [r for r in _records(payload) if r.get("weight") is not None]
    if not recs:
        return {}
    latest = max(recs, key=_day_key)
    return {"weight_kg": float(latest["weight"])}


# Biomarker -> condition rules. Matched by substring against the slug/name, so
# "hba1c" and "hemoglobin_a1c" both hit. Order matters within a marker (the
# first matching rule wins) so the diabetic band is checked before prediabetes.
_CONDITION_RULES: list[tuple[tuple[str, ...], object, str]] = [
    (("hba1c", "hemoglobin_a1c", "a1c"), lambda v: v >= 6.5, "type 2 diabetes"),
    (("hba1c", "hemoglobin_a1c", "a1c"), lambda v: v >= 5.7, "prediabetes"),
    (("ldl",), lambda v: v >= 160, "hyperlipidemia"),
    (("glucose",), lambda v: v >= 126, "hyperglycemia"),
    (("egfr",), lambda v: v < 60, "reduced renal function"),
]


def _as_float(value) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def derive_conditions(labs: list[dict]) -> list[str]:
    """Map biomarkers to a small, explicit condition list (deduped, ordered)."""
    found: list[str] = []
    for lab in labs:
        slug = str(lab.get("slug") or lab.get("name") or "").lower()
        value = _as_float(lab.get("value") if lab.get("value") is not None else lab.get("result"))
        if value is None:
            continue
        for keywords, predicate, condition in _CONDITION_RULES:
            if any(k in slug for k in keywords) and predicate(value):  # type: ignore[operator]
                if condition not in found:
                    found.append(condition)
                break  # first matching rule for this marker wins
    return found


def _biomarker_list(result: dict) -> list[dict]:
    """Find the biomarker array inside a /v3/order/{id}/result payload."""
    results = result.get("results", result)
    if isinstance(results, dict):
        return results.get("biomarkers") or results.get("markers") or []
    if isinstance(results, list):
        return results
    return []


def parse_labs(result: dict) -> dict:
    """Turn a lab-result payload into ``{labs: [...], conditions: [...]}``."""
    labs: list[dict] = []
    for b in _biomarker_list(result):
        value = b.get("value") if b.get("value") is not None else b.get("result")
        labs.append(
            {
                "name": b.get("name") or b.get("slug") or "biomarker",
                "slug": b.get("slug"),
                "value": value,
                "unit": b.get("unit"),
                "flag": b.get("interpretation") or b.get("flag"),
            }
        )
    return {"labs": labs, "conditions": derive_conditions(labs)}


def _public_lab(lab: dict) -> dict:
    """Drop the internal slug before sending labs to the frontend."""
    return {k: lab.get(k) for k in ("name", "value", "unit", "flag")}


# ============================================================ network (httpx)


async def _get(client: httpx.AsyncClient, path: str) -> dict:
    res = await client.get(f"{_base_url()}{path}", headers=_headers())
    res.raise_for_status()
    return res.json()


async def _post(client: httpx.AsyncClient, path: str, body: dict) -> dict:
    res = await client.post(f"{_base_url()}{path}", headers=_headers(), json=body)
    res.raise_for_status()
    return res.json()


async def get_or_create_user(user_ref: str) -> str:
    """Resolve a ``client_user_id`` to a Junction user_id, creating it if needed."""
    client_user_id = user_ref.lower()
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resolved = await _get(
                client, f"/v2/user/resolve/{quote(client_user_id, safe='')}"
            )
            if resolved.get("user_id"):
                return resolved["user_id"]
        except httpx.HTTPStatusError:
            pass  # not found -> create below
        created = await _post(client, "/v2/user", {"client_user_id": client_user_id})
        return created["user_id"]


async def create_link_token(user_ref: str) -> dict:
    """Create a Link token + the hosted URL the browser opens to connect a provider."""
    user_id = await get_or_create_user(user_ref)
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _post(client, "/v2/link/token", {"user_id": user_id})
    env, region = _link_env()
    link_url = (
        f"https://link.tryvital.io/?token={quote(token['link_token'], safe='')}"
        f"&env={env}&region={region}"
    )
    return {"user_id": user_id, "link_url": link_url}


async def is_connected(user_ref: str) -> bool:
    """True once the user has linked at least one provider."""
    user_id = await get_or_create_user(user_ref)
    async with httpx.AsyncClient(timeout=30) as client:
        data = await _get(client, f"/v2/user/providers/{user_id}")
    providers = data.get("providers") or []
    return len(providers) > 0


async def get_profile_and_body(user_ref: str) -> dict | None:
    """Build a ProfilePatch from the linked wearable, or None if not connected."""
    if not await is_connected(user_ref):
        return None
    user_id = await get_or_create_user(user_ref)
    rng = f"start_date={_HISTORY_START}&end_date={_today_iso()}"
    async with httpx.AsyncClient(timeout=30) as client:
        profile_raw: dict = {}
        body_raw: dict = {}
        try:
            profile_raw = await _get(client, f"/v2/summary/profile/{user_id}?{rng}")
        except httpx.HTTPStatusError:
            pass
        try:
            body_raw = await _get(client, f"/v2/summary/body/{user_id}?{rng}")
        except httpx.HTTPStatusError:
            pass

    patch: dict = {**parse_profile(profile_raw), **parse_body(body_raw)}
    label = profile_raw.get("source", {}).get("provider") if isinstance(
        profile_raw.get("source"), dict
    ) else None
    patch["source"] = {
        "kind": "device",
        "label": f"Imported from {label}" if label else "Imported from wearable",
        "at": _now_iso(),
    }
    return patch


async def _latest_order_id(client: httpx.AsyncClient, user_id: str) -> str | None:
    try:
        data = await _get(client, f"/v3/orders?user_id={user_id}")
    except httpx.HTTPStatusError:
        return None
    orders = data.get("orders") or data.get("data") or []
    return orders[0].get("id") if orders else None


async def get_lab_results(user_ref: str, order_id: str | None = None) -> dict:
    """Build a ProfilePatch from a lab-test order's biomarker results."""
    user_id = await get_or_create_user(user_ref)
    order_id = order_id or os.environ.get("JUNCTION_DEMO_ORDER_ID")
    async with httpx.AsyncClient(timeout=30) as client:
        if not order_id:
            order_id = await _latest_order_id(client, user_id)
        if not order_id:
            return {
                "conditions": [],
                "labs": [],
                "source": {
                    "kind": "bloodwork",
                    "label": "No lab order found",
                    "at": _now_iso(),
                },
            }
        result = await _get(client, f"/v3/order/{order_id}/result")

    parsed = parse_labs(result)
    return {
        "conditions": parsed["conditions"],
        "labs": [_public_lab(l) for l in parsed["labs"]],
        "source": {
            "kind": "bloodwork",
            "label": f"Bloodwork · {len(parsed['labs'])} biomarkers",
            "at": _now_iso(),
        },
    }
