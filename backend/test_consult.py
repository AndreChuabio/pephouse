"""Unit tests for the Consult layer.

These cover the honesty-relevant logic without any network:
  (a) the conversational context withholds raw lab values but keeps flags,
  (b) screen_eligibility on an anecdote-only compound returns void WITH a
      non-empty lower-tier signal (anecdotes + tier_notes) and never a refusal,
  (c) an intake insert round-trips through the Supabase client.

All external HTTP (Tavus / Anthropic) and the twin simulation are mocked; nothing
here calls a live service.
"""

from __future__ import annotations

import consult
from models import (
    AnecdoteSnippet,
    OutcomeResult,
    QuarterBand,
    ScreenEligibilityRequest,
    SimulateResponse,
    TrialIntake,
)


# ------------------------------------------------------ (a) PHI minimization


def _bundle_with_labs() -> dict:
    return {
        "age": 54,
        "sex": "M",
        "weight_kg": 96.0,
        "conditions": ["prediabetes"],
        "goals": ["fat loss"],
        "labs": [
            {
                "name": "Hemoglobin A1c",
                "value": "6.1",  # raw value must never leak
                "unit": "%",
                "status": "high",
                "ref_low": 4.0,
                "ref_high": 5.6,
            },
            {
                "name": "LDL Cholesterol",
                "value": "172",  # raw value must never leak
                "unit": "mg/dL",
                "flag": "high",
            },
        ],
        "wearable": [{"calendar_date": "2026-06-30", "resting_hr": 61}],
    }


def test_minimize_labs_drops_values_keeps_flags():
    phrases = consult.minimize_labs(_bundle_with_labs()["labs"])
    joined = " ".join(phrases)
    assert "high" in joined
    assert "Hemoglobin A1c" in joined
    # raw measured values are withheld
    assert "6.1" not in joined
    assert "172" not in joined


def test_context_withholds_raw_lab_values_but_keeps_flags():
    ctx = consult.build_conversational_context(
        _bundle_with_labs(), goal="fat loss", compound_name="Retatrutide"
    )
    # flags / conditions / framing survive
    assert "high" in ctx
    assert "Hemoglobin A1c" in ctx
    assert "prediabetes" in ctx
    assert "Retatrutide" in ctx
    # reference ranges (ranges, not measurements) may appear
    assert "ref 4.0-5.6" in ctx
    # raw measured lab values are never injected
    assert "6.1" not in ctx
    assert "172" not in ctx


def test_context_handles_missing_bundle():
    ctx = consult.build_conversational_context(None, goal="recomp")
    assert "recomp" in ctx
    assert "No connected member data" in ctx


# ------------------------------- (b) anecdote-only compound -> void + signal


def _void_response() -> SimulateResponse:
    """A simulation response for a compound with no trial prior: void outcome, but
    real lower-tier signal (anecdotes + tier notes) attached."""
    void_outcome = OutcomeResult(
        compound_id=99,
        outcome_name="weight_change_pct",
        unit=None,
        evidence_basis="anecdote",
        trial_backed=False,
        confidence=0.3,
        distribution_void=True,
        quarters=[],
    )
    return SimulateResponse(
        cohort_n=2,
        cohort_source="preloaded",
        substrate_missing=True,
        outcomes=[void_outcome],
        anecdotes=[
            AnecdoteSnippet(
                permalink="https://reddit.example/x",
                claimed_effect="lost 4kg over 8 weeks",
                sentiment="positive",
            )
        ],
        data_confidence="Low",
        tiers_requested=consult.SCREEN_TIERS,
        tiers_used=["anecdote"],
        tier_notes=["trial unavailable for this compound - skipped"],
    )


def test_screen_eligibility_void_returns_lower_tier_signal(monkeypatch):
    monkeypatch.setattr(consult, "resolve_compound", lambda name: 99)
    monkeypatch.setattr(consult.db, "get_outcome_priors", lambda cid: [])
    monkeypatch.setattr(consult, "run_simulation", lambda **kwargs: _void_response())

    req = ScreenEligibilityRequest(age=45, sex="M", weight_kg=90.0, compound_name="MysteryPeptide")
    result = consult.screen_eligibility(req)

    # void read, but never an empty refusal
    assert result["eligibility"] == "no_trial"
    assert result["distribution_void"] is True
    assert result["quarters"] == []
    # the lower-tier signal is present and non-empty
    assert len(result["anecdotes"]) > 0
    assert len(result["tier_notes"]) > 0
    # cohort is echoed so the persona can be honest about the substrate
    assert result["cohort_n"] == 2
    assert result["eligibility_reason"]


def _trial_response() -> SimulateResponse:
    quarters = [
        QuarterBand(q=1, month=3, p10=-2.0, p50=-3.5, p90=-5.0),
        QuarterBand(q=4, month=12, p10=-8.0, p50=-12.0, p90=-16.0),
    ]
    outcome = OutcomeResult(
        compound_id=7,
        outcome_name="weight_change_pct",
        unit="%",
        evidence_basis="trial",
        trial_backed=True,
        confidence=0.8,
        distribution_void=False,
        quarters=quarters,
    )
    return SimulateResponse(
        cohort_n=40,
        outcomes=[outcome],
        data_confidence="High",
        tiers_used=["trial"],
        tier_notes=[],
    )


def test_screen_eligibility_trial_returns_quarters(monkeypatch):
    monkeypatch.setattr(consult, "resolve_compound", lambda name: 7)
    monkeypatch.setattr(consult.db, "get_outcome_priors", lambda cid: [{"outcome_name": "weight_change_pct"}])
    monkeypatch.setattr(consult, "run_simulation", lambda **kwargs: _trial_response())

    req = ScreenEligibilityRequest(age=45, sex="M", weight_kg=90.0, compound_name="Semaglutide")
    result = consult.screen_eligibility(req)

    assert result["eligibility"] == "eligible"
    assert len(result["quarters"]) == 2
    assert result.get("distribution_void") is None


def test_screen_eligibility_unresolved_compound_never_refuses(monkeypatch):
    monkeypatch.setattr(consult, "resolve_compound", lambda name: None)
    req = ScreenEligibilityRequest(age=45, sex="M", weight_kg=90.0, compound_name="Nonexistent")
    result = consult.screen_eligibility(req)
    assert result["found"] is False
    assert result["eligibility"] == "unknown"
    assert result["eligibility_reason"]


# ------------------------------------------------ (c) intake insert round-trip


class _FakeExecute:
    def __init__(self, data):
        self.data = data


class _FakeInsert:
    def __init__(self, table, row):
        self._table = table
        self._row = row

    def execute(self):
        # Simulate Postgres identity + defaults being returned by insert().
        saved = {"id": 4242, "status": "submitted", **self._row}
        self._table.inserted.append(saved)
        return _FakeExecute([saved])


class _FakeTable:
    def __init__(self):
        self.inserted: list[dict] = []

    def insert(self, row):
        return _FakeInsert(self, row)


class _FakeSupabase:
    def __init__(self):
        self._tables: dict[str, _FakeTable] = {}

    def table(self, name):
        return self._tables.setdefault(name, _FakeTable())


def test_intake_insert_round_trips(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(consult, "supabase", fake)
    monkeypatch.setattr(consult, "resolve_compound", lambda name: 7)

    intake = TrialIntake(
        user_ref="browser-abc",
        goal="fat loss",
        compound_name="Semaglutide",
        eligibility="eligible",
        eligibility_reason="within studied age range",
        consent=True,
        context_snapshot={"flags": ["A1c high"], "goal": "fat loss"},
        counsel_summary="Discussed trial-grade evidence and dosing cadence.",
    )
    result = consult.insert_intake(intake)

    assert result == {"id": 4242, "status": "submitted"}
    row = fake.table("trial_intakes").inserted[0]
    assert row["user_ref"] == "browser-abc"
    assert row["compound_id"] == 7
    assert row["consent"] is True
    # context_snapshot is stored as passed (caller keeps it PHI-minimized)
    assert row["context_snapshot"] == {"flags": ["A1c high"], "goal": "fat loss"}
    # no raw lab value ever reaches the row
    assert "6.1" not in str(row)


# ------------------------------------------------ biomarker extraction (mocked)


def test_extract_biomarkers_parses_mocked_llm_json(monkeypatch):
    payload = (
        '[{"name": "Hemoglobin A1c", "value": "6.1", "unit": "%", "status": "high", '
        '"ref_low": 4.0, "ref_high": 5.6}]'
    )
    monkeypatch.setattr(consult, "_claude_json", lambda prompt, max_tokens=1200: payload)
    labs = consult.extract_biomarkers("A1c 6.1 % High")
    assert len(labs) == 1
    assert labs[0].name == "Hemoglobin A1c"
    assert labs[0].status == "high"
    assert labs[0].ref_high == 5.6


def test_extract_biomarkers_strips_markdown_fence(monkeypatch):
    payload = '```json\n[{"name": "LDL", "status": "high"}]\n```'
    monkeypatch.setattr(consult, "_claude_json", lambda prompt, max_tokens=1200: payload)
    labs = consult.extract_biomarkers("LDL high")
    assert len(labs) == 1
    assert labs[0].name == "LDL"


def test_extract_biomarkers_empty_on_no_key(monkeypatch):
    monkeypatch.setattr(consult, "_claude_json", lambda prompt, max_tokens=1200: None)
    assert consult.extract_biomarkers("anything") == []


def test_snapshot_allowlist_drops_unknown_and_blocked_keys():
    snapshot = {
        "goal": "recovery",
        "eligibility": "excluded",
        "lab_flags": [{"marker": "ApoB", "flag": "high", "value": 130}],
        "summary": "LDL was 190 mg/dL, call me at 555-1234",
        "phone": "+15551234",
    }
    cleaned = consult.minimize_context_snapshot(snapshot)
    assert cleaned["goal"] == "recovery"
    assert cleaned["eligibility"] == "excluded"
    # allowlisted container kept, but the raw value inside is stripped
    assert cleaned["lab_flags"] == [{"marker": "ApoB", "flag": "high"}]
    # non-allowlisted free text and identifiers are dropped wholesale
    assert "summary" not in cleaned
    assert "phone" not in cleaned


def test_coerce_labs_skips_malformed_items():
    payload = '[{"name": "A1c", "value": {"result": 6.1}}, {"name": "LDL", "status": "high"}]'
    parsed = consult.extract_biomarkers.__globals__["json"].loads(payload)
    labs = consult._coerce_labs(parsed)
    assert [l.name for l in labs] == ["LDL"]
