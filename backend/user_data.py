"""Persistence for user-connected / -reported health data (Supabase).

Mirrors the Junction (Vital) ProfilePatch shape so a live Junction pull and a
stored mock are interchangeable downstream. Uses the service_role client from
``db`` — server-side only.

Tables (see db/user_data.sql):
  user_profiles          one derived patch per browser ``user_ref``
  user_wearable_metrics  daily wearable summaries
  user_lab_results       bloodwork biomarkers
"""

from __future__ import annotations

from db import supabase


def _profile_row(user_ref: str) -> dict | None:
    rows = (
        supabase.table("user_profiles").select("*").eq("user_ref", user_ref).execute().data
    )
    return rows[0] if rows else None


def get_user_data(user_ref: str) -> dict | None:
    """Return the full stored bundle for ``user_ref``, or None if unknown.

    Shape: {user_ref, connected, age, sex, weight_kg, conditions, source,
            labs[], wearable[]} — the labs/profile fields match ProfilePatch.
    """
    profile = _profile_row(user_ref)
    if profile is None:
        return None

    labs = (
        supabase.table("user_lab_results")
        .select("name,value,unit,flag,status,ref_low,ref_high")
        .eq("user_ref", user_ref)
        .execute()
        .data
    )
    wearable = (
        supabase.table("user_wearable_metrics")
        .select("calendar_date,steps,resting_hr,hrv_ms,sleep_hours,calories,weight_kg,provider")
        .eq("user_ref", user_ref)
        .order("calendar_date", desc=True)
        .execute()
        .data
    )

    return {
        "user_ref": user_ref,
        "connected": profile.get("connected", False),
        "age": profile.get("age"),
        "sex": profile.get("sex"),
        "weight_kg": profile.get("weight_kg"),
        "conditions": profile.get("conditions") or [],
        "goals": profile.get("goals") or [],
        "source": {
            "kind": profile.get("source_kind"),
            "label": profile.get("source_label"),
            "at": profile.get("updated_at"),
        },
        "labs": labs,
        "wearable": wearable,
    }


def save_user_data(user_ref: str, patch: dict) -> dict:
    """Upsert a connected/reported patch, then return the merged bundle.

    Profile fields (age/sex/weight_kg/conditions/source) are upserted onto
    ``user_profiles``. ``labs`` and ``wearable``, when present, fully replace the
    stored rows for this user (an import is the source of truth for its kind).
    None-valued profile fields are skipped so a labs-only import doesn't wipe
    age/weight set by a prior wearable import.
    """
    source = patch.get("source") or {}
    profile: dict = {"user_ref": user_ref, "connected": True}
    for key in ("age", "sex", "weight_kg"):
        if patch.get(key) is not None:
            profile[key] = patch[key]
    if patch.get("conditions") is not None:
        profile["conditions"] = patch["conditions"]
    if patch.get("goals") is not None:
        profile["goals"] = patch["goals"]
    if source.get("kind"):
        profile["source_kind"] = source["kind"]
    if source.get("label"):
        profile["source_label"] = source["label"]

    supabase.table("user_profiles").upsert(profile, on_conflict="user_ref").execute()

    labs = patch.get("labs")
    if labs is not None:
        supabase.table("user_lab_results").delete().eq("user_ref", user_ref).execute()
        if labs:
            supabase.table("user_lab_results").insert(
                [
                    {
                        "user_ref": user_ref,
                        "name": l.get("name"),
                        "slug": l.get("slug"),
                        "value": None if l.get("value") is None else str(l["value"]),
                        "unit": l.get("unit"),
                        "flag": l.get("flag"),
                        "status": l.get("status"),
                        "ref_low": l.get("ref_low"),
                        "ref_high": l.get("ref_high"),
                        "source_kind": source.get("kind"),
                        "source_label": source.get("label"),
                    }
                    for l in labs
                ]
            ).execute()

    wearable = patch.get("wearable")
    if wearable is not None:
        supabase.table("user_wearable_metrics").delete().eq("user_ref", user_ref).execute()
        if wearable:
            supabase.table("user_wearable_metrics").insert(
                [{"user_ref": user_ref, **w} for w in wearable]
            ).execute()

    return get_user_data(user_ref) or {"user_ref": user_ref, "connected": True}
