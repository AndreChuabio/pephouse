"""Tests for the stack report — chiefly, the honesty of its tiering.

The bug these guard against was live and would have shipped: `_evidence_sources`
counted every row in `trials` regardless of status, so a compound whose only
trials were REGISTERED but never finished came out reading as trial-backed. In
the real registry that hit BPC-157, CJC-1295, GHK-Cu and Melanotan II — four
compounds with zero completed trials, one of which has documented melanoma and
rhabdomyolysis case reports. The product would have told a paying customer they
had trial-grade evidence behind them.

A registered trial is a promise. Only a finished one is a finding.
"""

from __future__ import annotations

import pytest

import evidence
import report


# ------------------------------------------------- a registered trial is not evidence


def test_recruiting_trial_is_not_counted_as_evidence():
    trials = [
        {"nct_id": "NCT1", "status": "RECRUITING"},
        {"nct_id": "NCT2", "status": "NOT_YET_RECRUITING"},
        {"nct_id": "NCT3", "status": "UNKNOWN"},
        {"nct_id": "NCT4", "status": "ACTIVE_NOT_RECRUITING"},
    ]
    assert evidence.completed_trials(trials) == []
    assert len(evidence.unfinished_trials(trials)) == 4


def test_completed_trial_is_evidence():
    trials = [{"nct_id": "NCT1", "status": "COMPLETED"}, {"nct_id": "NCT2", "status": "RECRUITING"}]
    assert [t["nct_id"] for t in evidence.completed_trials(trials)] == ["NCT1"]
    assert [t["nct_id"] for t in evidence.unfinished_trials(trials)] == ["NCT2"]


def test_status_matching_is_case_and_whitespace_insensitive():
    assert len(evidence.completed_trials([{"status": " completed "}])) == 1
    assert len(evidence.completed_trials([{"status": None}])) == 0


def test_top_rung_ignores_unfinished_trials():
    """A compound with only registered trials must not reach the RCT rung."""
    tables = {
        "trials": [{"status": "RECRUITING"}, {"status": "UNKNOWN"}],
        "outcome_priors": [],
        "research_papers": [{"id": 1}],
        "anecdotes": [{"id": 1}],
        "vendor_lab_results": [],
        "sourcing": [],
    }
    sources = {s.id: s for s in evidence._evidence_sources(tables)}

    # Two trials on file, but neither finished: the top rung stays empty.
    assert sources["rct"].count == 0
    assert sources["rct"].available is False
    # The evidence that does exist is correctly graded one rung down.
    assert sources["observational"].available is True


# ------------------------------------------------------------------ the verdicts


@pytest.mark.parametrize(
    "top_tier,expected",
    [
        (4, "trial_backed"),
        (3, "observational_only"),
        (2, "source_data_only"),
        (1, "anecdote_only"),
        (0, "no_evidence"),
    ],
)
def test_every_tier_has_a_verdict(top_tier, expected):
    key, text = report.VERDICTS[top_tier]
    assert key == expected
    assert text  # never an empty string


def test_anecdote_only_verdict_does_not_hedge():
    """The tier-1 verdict must say plainly that there is no proof."""
    _, text = report.VERDICTS[1]
    lowered = text.lower()
    assert "no trial evidence" in lowered
    assert "anecdote" in lowered


# -------------------------------------------------------------- the interactions


def test_unknown_interaction_pair_is_not_reported_as_safe(monkeypatch):
    """Silence in the interaction table must never render as 'no known interaction'."""
    monkeypatch.setattr(report.db, "fetch_drug_interactions", lambda ids: [])
    monkeypatch.setattr(
        report.db, "get_compounds_by_ids", lambda ids: {1: {"name": "A"}, 2: {"name": "B"}}
    )

    result = report._interactions([1, 2])

    assert result["pairs_without_data"] == 1
    pair = result["pairs"][0]
    assert pair["severity"] == "unknown"
    assert pair["has_data"] is False
    assert "does not mean the combination is safe" in result["note"]


# ----------------------------------------------------------------- the headline


def test_headline_leads_with_the_weakest_link():
    line = report._headline(3, ["Tirzepatide"], ["BPC-157", "CJC-1295"])
    assert "BPC-157" in line and "CJC-1295" in line
    assert "1 of 3" in line


def test_headline_when_nothing_is_trial_backed():
    line = report._headline(2, [], ["BPC-157", "Melanotan II"])
    assert "None of the 2" in line


def test_headline_never_claims_all_when_some_are_weak():
    """The regression: buckets that did not cover the stack reported 3 trial-backed
    compounds out of 8 as 'all 8 have trial-grade evidence'."""
    line = report._headline(
        8,
        ["Semaglutide", "Tirzepatide", "Retatrutide"],
        ["BPC-157", "Melanotan II", "GHK-Cu", "CJC-1295", "Sermorelin"],
    )
    assert not line.startswith("All 8")
    assert "3 of 8" in line
    assert "BPC-157" in line
