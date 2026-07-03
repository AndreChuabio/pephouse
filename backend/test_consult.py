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

import asyncio

import httpx
import pytest

import consult
from models import (
    AnecdoteSnippet,
    CompoundEvidenceRequest,
    ConsultSessionRequest,
    ExcludedPrior,
    LabValue,
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
    # the wearable branch fires, but raw measurements and dates are withheld
    # exactly like lab values (the bundle carries resting_hr 61 on 2026-06-30)
    assert "Wearable data is connected" in ctx
    assert "61" not in ctx
    assert "2026-06-30" not in ctx


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


# --------------------------------------------- snapshot free-text scrubbing


def test_snapshot_scrubs_measurements_and_contacts_from_free_text():
    snapshot = {
        "goal": "fat loss. LDL was 190 mg/dL, call me at 555-1234",
        "conditions": ["prediabetes, phone 555-987-6543", "email me at a@b.com"],
        "eligibility_reason": "age 61 outside studied range 18-55",
    }
    cleaned = consult.minimize_context_snapshot(snapshot)
    text = str(cleaned)
    # raw measurement and contact details are redacted from allowlisted strings
    assert "190" not in text
    assert "555-1234" not in text
    assert "555-987-6543" not in text
    assert "a@b.com" not in text
    # the useful framing survives
    assert "fat loss" in cleaned["goal"]
    assert "prediabetes" in cleaned["conditions"][0]
    # unit-less short ranges (studied age spans) are NOT measurements
    assert cleaned["eligibility_reason"] == "age 61 outside studied range 18-55"


def test_snapshot_flag_container_keeps_marker_name():
    snapshot = {
        "lab_flags": [{"name": "ApoB", "flag": "high", "value": 130}],
        "flags": [{"patient_name": "Bob Smith", "name": "LDL", "flag": "high"}],
    }
    cleaned = consult.minimize_context_snapshot(snapshot)
    # inside flag containers "name" is the biomarker label and must survive;
    # raw values and person-name keys are still stripped
    assert cleaned["lab_flags"] == [{"name": "ApoB", "flag": "high"}]
    assert cleaned["flags"] == [{"name": "LDL", "flag": "high"}]


def test_intake_insert_scrubs_free_text_fields(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(consult, "supabase", fake)
    monkeypatch.setattr(consult, "resolve_compound", lambda name: 7)

    intake = TrialIntake(
        user_ref="browser-abc",
        goal="fat loss, LDL was 190 mg/dL",
        compound_name="Semaglutide",
        eligibility="excluded",
        eligibility_reason="age 61 outside studied range 18-55",
        consent=True,
        counsel_summary="Member said A1c hit 6.1 %; wants a callback at 555-1234.",
    )
    consult.insert_intake(intake)

    row = fake.table("trial_intakes").inserted[0]
    text = str(row)
    assert "190" not in text
    assert "6.1" not in text
    assert "555-1234" not in text
    # non-measurement content survives
    assert "fat loss" in row["goal"]
    assert row["eligibility_reason"] == "age 61 outside studied range 18-55"


# --------------------------------------------------- labs upload (mocked I/O)


def test_upload_labs_zero_extraction_leaves_stored_labs_untouched(monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(consult, "_extract_pdf_text", lambda data: "some text")
    monkeypatch.setattr(consult, "extract_biomarkers", lambda text: [])

    def _spy_save(user_ref, patch):
        captured["user_ref"] = user_ref
        captured["patch"] = patch
        return {"connected": True}

    monkeypatch.setattr(consult.user_data, "save_user_data", _spy_save)

    result = consult.upload_labs("u1", b"%PDF")

    # a zero-biomarker extraction must OMIT the labs key: an empty list would
    # silently delete every stored lab row for the member
    assert "labs" not in captured["patch"]
    assert captured["patch"]["source"]["kind"] == "upload"
    assert result.extracted_count == 0


def test_upload_labs_saves_extracted_labs(monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(consult, "_extract_pdf_text", lambda data: "some text")
    monkeypatch.setattr(
        consult, "extract_biomarkers", lambda text: [LabValue(name="LDL", status="high")]
    )

    def _spy_save(user_ref, patch):
        captured["patch"] = patch
        return {"connected": True}

    monkeypatch.setattr(consult.user_data, "save_user_data", _spy_save)

    result = consult.upload_labs("u1", b"%PDF")

    assert len(captured["patch"]["labs"]) == 1
    assert captured["patch"]["labs"][0]["name"] == "LDL"
    assert result.extracted_count == 1


# ------------------------------------------------- session mint (mocked Tavus)


def test_start_session_survives_user_data_failure(monkeypatch):
    recorded: dict = {}

    def _boom(user_ref):
        raise RuntimeError("supabase blip")

    async def _fake_create(context, tags):
        recorded["context"] = context
        recorded["tags"] = tags
        return {"conversation_url": "https://u", "conversation_id": "c1", "pal_id": "pal"}

    monkeypatch.setattr(consult.user_data, "get_user_data", _boom)
    monkeypatch.setattr(consult, "_tavus_ids", lambda: ("pal", "face"))
    monkeypatch.setattr(consult, "create_conversation", _fake_create)

    result = asyncio.run(
        consult.start_session(ConsultSessionRequest(user_ref="u1", goal="fat loss"))
    )

    # a data-store failure degrades to the no-data context; the session still mints
    assert result.conversation_url == "https://u"
    assert result.conversation_id == "c1"
    assert result.pal_id == "pal"
    assert "No connected member data" in recorded["context"]
    assert recorded["tags"] == consult.DOCUMENT_TAGS


def test_start_session_propagates_tavus_http_error(monkeypatch):
    async def _fail(context, tags):
        req = httpx.Request("POST", "https://tavusapi.com/v2/conversations")
        res = httpx.Response(500, request=req, text="boom")
        raise httpx.HTTPStatusError("boom", request=req, response=res)

    monkeypatch.setattr(consult.user_data, "get_user_data", lambda ref: None)
    monkeypatch.setattr(consult, "_tavus_ids", lambda: ("pal", "face"))
    monkeypatch.setattr(consult, "create_conversation", _fail)

    # main.py maps this to a 502; the exception type must keep propagating
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(consult.start_session(ConsultSessionRequest(user_ref="u1")))


# ------------------------------------------------ eligibility: excluded branch


def test_screen_eligibility_excluded_returns_reason(monkeypatch):
    resp = _void_response()
    resp.excluded_priors = [
        ExcludedPrior(
            compound_id=99,
            outcome_name="weight_change_pct",
            reason="age 61 outside studied range 18-55",
        )
    ]
    monkeypatch.setattr(consult, "resolve_compound", lambda name: 99)
    monkeypatch.setattr(consult.db, "get_outcome_priors", lambda cid: [])
    monkeypatch.setattr(consult, "run_simulation", lambda **kwargs: resp)

    req = ScreenEligibilityRequest(age=61, sex="M", weight_kg=90.0, compound_name="X")
    result = consult.screen_eligibility(req)

    assert result["eligibility"] == "excluded"
    assert result["eligibility_reason"] == "age 61 outside studied range 18-55"
    assert result["distribution_void"] is True
    # the lower-tier signal still ships alongside the exclusion
    assert len(result["anecdotes"]) > 0


# ---------------------------------------------------- dossier slug resolution


class _StubDossierBundle:
    def model_dump(self):
        return {"name": "Melanotan II", "tables": {}, "evidence_sources": []}


def test_dossier_slug_resolves_multiword_compound(monkeypatch):
    monkeypatch.setattr(
        consult.db,
        "get_compounds",
        lambda: [{"id": 5, "name": "Melanotan II"}, {"id": 6, "name": "BPC-157"}],
    )
    monkeypatch.setattr(consult, "build_simulation_data", lambda cid: _StubDossierBundle())

    text = consult.get_dossier_text("melanotan-ii")
    assert text is not None
    assert text.startswith("# Melanotan II evidence dossier")
    assert consult.get_dossier_text("bpc-157") is not None
    # unknown and empty slugs must not match anything
    assert consult.get_dossier_text("unknown-thing") is None
    assert consult.get_dossier_text("") is None
    # pin the filename convention shared with scripts/register_kb.py
    assert consult._canon_slug("Melanotan II") == "melanotan-ii"


# ------------------------------------------- evidence: demographic filtering


class _StubEvidenceBundle:
    name = "X"
    summary = "test summary"
    evidence_sources: list = []
    outcome_names = ["weight_change_pct"]
    studied_age_min = 18
    studied_age_max = 55
    tables = {
        "case_studies": [{"text": "female, 45"}, {"text": "male, 30"}],
        "anecdotes": [{"claimed_effect": "female lost 3kg"}],
    }


def test_get_compound_evidence_demographic_filter_and_fallback(monkeypatch):
    monkeypatch.setattr(consult, "resolve_compound", lambda name: 7)
    monkeypatch.setattr(consult, "build_simulation_data", lambda cid: _StubEvidenceBundle())

    # matching rows only, case-insensitive
    result = consult.get_compound_evidence(
        CompoundEvidenceRequest(compound_name="X", demographic="Female")
    )
    assert result["found"] is True
    assert result["case_studies"] == [{"text": "female, 45"}]
    assert result["anecdotes"] == [{"claimed_effect": "female lost 3kg"}]

    # a filter that matches nothing falls back to the unfiltered rows, never []
    result = consult.get_compound_evidence(
        CompoundEvidenceRequest(compound_name="X", demographic="martian")
    )
    assert len(result["case_studies"]) == 2
    assert len(result["anecdotes"]) == 1
