"""Unit tests for the user-data deletion path (settings page "delete my data").

Covers the contract without any network:
  (a) DELETE removes every row keyed by user_ref across all five user tables
      and reports the per-table counts,
  (b) an empty user_ref is rejected (400 at the endpoint, ValueError below it),
  (c) deleting a user_ref with no rows succeeds with all-zero counts.

The Supabase client is faked in every module that touches a user table
(user_data / user_stack / consult); nothing here calls a live service.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import consult
import main
import user_data
import user_stack

USER_TABLES = (
    "user_profiles",
    "user_lab_results",
    "user_wearable_metrics",
    "user_stack",
    "trial_intakes",
)


# ------------------------------------------------------------- fake Supabase


class _FakeExecute:
    def __init__(self, data):
        self.data = data


class _FakeDelete:
    """Mimics table.delete().eq(col, val).execute() returning deleted rows."""

    def __init__(self, table):
        self._table = table
        self._filters: list[tuple[str, object]] = []

    def eq(self, column, value):
        self._filters.append((column, value))
        return self

    def execute(self):
        matched = [
            row
            for row in self._table.rows
            if all(row.get(col) == val for col, val in self._filters)
        ]
        self._table.rows = [row for row in self._table.rows if row not in matched]
        return _FakeExecute(matched)


class _FakeTable:
    def __init__(self):
        self.rows: list[dict] = []

    def delete(self):
        return _FakeDelete(self)


class _FakeSupabase:
    def __init__(self):
        self._tables: dict[str, _FakeTable] = {}

    def table(self, name):
        return self._tables.setdefault(name, _FakeTable())


def _seeded_fake() -> _FakeSupabase:
    """A fake store with rows for user u1 (varying counts) and bystander u2."""
    fake = _FakeSupabase()
    fake.table("user_profiles").rows = [{"user_ref": "u1"}, {"user_ref": "u2"}]
    fake.table("user_lab_results").rows = [
        {"user_ref": "u1", "name": "LDL"},
        {"user_ref": "u1", "name": "A1c"},
        {"user_ref": "u2", "name": "LDL"},
    ]
    fake.table("user_wearable_metrics").rows = [
        {"user_ref": "u1", "calendar_date": "2026-07-01"},
        {"user_ref": "u1", "calendar_date": "2026-07-02"},
        {"user_ref": "u1", "calendar_date": "2026-07-03"},
    ]
    fake.table("user_stack").rows = [{"user_ref": "u1", "id": 1}]
    fake.table("trial_intakes").rows = [
        {"user_ref": "u1", "id": 9},
        {"user_ref": "u2", "id": 10},
    ]
    return fake


def _patch_supabase(monkeypatch, fake):
    monkeypatch.setattr(user_data, "supabase", fake)
    monkeypatch.setattr(user_stack, "supabase", fake)
    monkeypatch.setattr(consult, "supabase", fake)


# ------------------------------------ (a) deletes across all five tables


def test_endpoint_deletes_across_all_tables_and_reports_counts(monkeypatch):
    fake = _seeded_fake()
    _patch_supabase(monkeypatch, fake)
    client = TestClient(main.app)

    res = client.delete("/users/u1/data")

    assert res.status_code == 200
    assert res.json() == {
        "deleted": True,
        "tables": {
            "user_profiles": 1,
            "user_lab_results": 2,
            "user_wearable_metrics": 3,
            "user_stack": 1,
            "trial_intakes": 1,
        },
    }
    # every u1 row is gone; the bystander user's rows survive
    for table in USER_TABLES:
        rows = fake.table(table).rows
        assert all(row["user_ref"] != "u1" for row in rows)
    assert fake.table("user_profiles").rows == [{"user_ref": "u2"}]
    assert fake.table("trial_intakes").rows == [{"user_ref": "u2", "id": 10}]


def test_module_delete_functions_return_counts(monkeypatch):
    fake = _seeded_fake()
    _patch_supabase(monkeypatch, fake)

    assert user_data.delete_user_data("u1") == {
        "user_profiles": 1,
        "user_lab_results": 2,
        "user_wearable_metrics": 3,
    }
    assert user_stack.delete_stack("u1") == 1
    assert consult.delete_intakes("u1") == 1


# --------------------------------------------- (b) empty user_ref rejected


def test_empty_user_ref_is_rejected(monkeypatch):
    fake = _FakeSupabase()
    _patch_supabase(monkeypatch, fake)

    with pytest.raises(ValueError):
        user_data.delete_user_data("")
    with pytest.raises(ValueError):
        user_stack.delete_stack("")
    with pytest.raises(ValueError):
        consult.delete_intakes("")

    # a whitespace-only ref reaches the route and must 400, not delete
    client = TestClient(main.app)
    res = client.delete("/users/%20/data")
    assert res.status_code == 400


# ------------------------------------------ (c) no-rows user is a success


def test_deleting_unknown_user_succeeds_with_zero_counts(monkeypatch):
    fake = _seeded_fake()
    _patch_supabase(monkeypatch, fake)
    client = TestClient(main.app)

    res = client.delete("/users/nobody/data")

    assert res.status_code == 200
    body = res.json()
    assert body["deleted"] is True
    assert body["tables"] == {table: 0 for table in USER_TABLES}
    # nothing else was touched
    assert len(fake.table("user_lab_results").rows) == 3


# --------------------------------------------- Supabase failure -> HTTP 502


class _BoomSupabase:
    def table(self, name):
        raise RuntimeError("supabase down")


def test_supabase_failure_surfaces_as_502(monkeypatch):
    _patch_supabase(monkeypatch, _BoomSupabase())
    client = TestClient(main.app)

    res = client.delete("/users/u1/data")

    assert res.status_code == 502
    assert "data deletion failed" in res.json()["detail"]
