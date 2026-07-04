"""Persistence for a user's compound stack (Supabase user_stack table).

Each row is one compound a user added on the Digital Twin, with dose + source.
All functions degrade gracefully if the table doesn't exist yet (returns empty /
no-op) so the app still runs before db/user_stack.sql has been applied.
"""

from __future__ import annotations

from db import supabase


def get_stack(user_ref: str) -> list[dict]:
    try:
        return (
            supabase.table("user_stack")
            .select("id,compound_id,compound_name,dose,source_type,created_at")
            .eq("user_ref", user_ref)
            .order("created_at")
            .execute()
            .data
        )
    except Exception:  # noqa: BLE001 - table may not exist yet
        return []


def add_item(user_ref: str, item: dict) -> dict | None:
    row = {
        "user_ref": user_ref,
        "compound_id": item.get("compound_id"),
        "compound_name": item.get("compound_name"),
        "dose": item.get("dose"),
        "source_type": item.get("source_type"),
    }
    try:
        res = supabase.table("user_stack").insert(row).execute()
        return res.data[0] if res.data else None
    except Exception:  # noqa: BLE001
        return None


def remove_item(user_ref: str, item_id: int) -> None:
    try:
        supabase.table("user_stack").delete().eq("user_ref", user_ref).eq("id", item_id).execute()
    except Exception:  # noqa: BLE001
        pass


def delete_stack(user_ref: str) -> int:
    """Delete every stack row for ``user_ref``; returns the rows removed.

    Unlike the read/add paths this does NOT swallow errors: a data-deletion
    request must never fail silently, so Supabase errors propagate to the
    caller. Raises ValueError on an empty user_ref.
    """
    if not user_ref:
        raise ValueError("user_ref required")
    res = supabase.table("user_stack").delete().eq("user_ref", user_ref).execute()
    return len(res.data or [])
