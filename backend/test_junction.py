"""Unit tests for the pure Junction mappers.

These hold the honesty-relevant logic (biomarker -> condition) and the
demographic parsing, so they are tested without any network.
"""

from __future__ import annotations

from datetime import date

import junction


# ------------------------------------------------------------------ calc_age

def test_calc_age_basic():
    assert junction.calc_age("1980-06-01", today=date(2026, 6, 27)) == 46


def test_calc_age_before_birthday_this_year():
    # birthday hasn't happened yet in the reference year
    assert junction.calc_age("1980-12-31", today=date(2026, 6, 27)) == 45


def test_calc_age_handles_datetime_string():
    assert junction.calc_age("1990-01-15T00:00:00Z", today=date(2026, 6, 27)) == 36


def test_calc_age_none_for_missing():
    assert junction.calc_age(None, today=date(2026, 6, 27)) is None
    assert junction.calc_age("", today=date(2026, 6, 27)) is None
    assert junction.calc_age("not-a-date", today=date(2026, 6, 27)) is None


# -------------------------------------------------------------- parse_profile

def test_parse_profile_maps_sex_and_age():
    out = junction.parse_profile(
        {"birth_date": "1980-06-01", "sex": "male"}, today=date(2026, 6, 27)
    )
    assert out == {"age": 46, "sex": "M"}


def test_parse_profile_prefers_sex_then_gender():
    assert junction.parse_profile({"gender": "female"})["sex"] == "F"
    assert junction.parse_profile({"sex": "female", "gender": "male"})["sex"] == "F"


def test_parse_profile_omits_unknown_sex():
    out = junction.parse_profile({"sex": "unknown", "birth_date": None})
    assert "sex" not in out
    assert "age" not in out


# ----------------------------------------------------------------- parse_body

def test_parse_body_takes_latest_weight():
    records = [
        {"calendar_date": "2026-06-01", "weight": 100.0},
        {"calendar_date": "2026-06-20", "weight": 97.5},
        {"calendar_date": "2026-05-01", "weight": 103.0},
    ]
    assert junction.parse_body({"body": records}) == {"weight_kg": 97.5}


def test_parse_body_accepts_bare_list_and_data_key():
    recs = [{"calendar_date": "2026-06-20", "weight": 88.0}]
    assert junction.parse_body(recs) == {"weight_kg": 88.0}
    assert junction.parse_body({"data": recs}) == {"weight_kg": 88.0}


def test_parse_body_empty_returns_empty():
    assert junction.parse_body({"body": []}) == {}
    assert junction.parse_body({}) == {}


# --------------------------------------------------------- derive_conditions

def test_hba1c_diabetic_threshold():
    assert "type 2 diabetes" in junction.derive_conditions(
        [{"slug": "hba1c", "value": 7.1}]
    )


def test_hba1c_prediabetic_band():
    conds = junction.derive_conditions([{"slug": "hba1c", "value": 6.0}])
    assert "prediabetes" in conds
    assert "type 2 diabetes" not in conds


def test_ldl_and_glucose_and_egfr():
    labs = [
        {"slug": "ldl", "value": 165},
        {"slug": "glucose_fasting", "value": 130},
        {"slug": "egfr", "value": 52},
    ]
    conds = junction.derive_conditions(labs)
    assert "hyperlipidemia" in conds
    assert "hyperglycemia" in conds
    assert "reduced renal function" in conds


def test_normal_labs_no_conditions():
    labs = [
        {"slug": "hba1c", "value": 5.2},
        {"slug": "ldl", "value": 90},
        {"slug": "egfr", "value": 95},
    ]
    assert junction.derive_conditions(labs) == []


def test_derive_conditions_deduplicates():
    labs = [{"slug": "hba1c", "value": 7.0}, {"slug": "hemoglobin_a1c", "value": 8.0}]
    assert junction.derive_conditions(labs) == ["type 2 diabetes"]


# ------------------------------------------------------------------ parse_labs

def test_parse_labs_extracts_biomarkers_and_conditions():
    result_json = {
        "results": {
            "biomarkers": [
                {"name": "Hemoglobin A1c", "slug": "hba1c", "result": "6.8", "unit": "%"},
                {"name": "LDL Cholesterol", "slug": "ldl", "result": "120", "unit": "mg/dL"},
            ]
        }
    }
    out = junction.parse_labs(result_json)
    assert len(out["labs"]) == 2
    assert out["labs"][0]["name"] == "Hemoglobin A1c"
    assert out["labs"][0]["value"] == "6.8"
    assert "type 2 diabetes" in out["conditions"]
    # LDL 120 is below the 160 threshold -> no hyperlipidemia
    assert "hyperlipidemia" not in out["conditions"]


def test_parse_labs_tolerates_flat_results_list():
    result_json = {"results": [{"name": "eGFR", "slug": "egfr", "value": 50, "unit": "mL/min"}]}
    out = junction.parse_labs(result_json)
    assert out["labs"][0]["name"] == "eGFR"
    assert "reduced renal function" in out["conditions"]


def test_parse_labs_empty():
    assert junction.parse_labs({"results": {"biomarkers": []}}) == {"labs": [], "conditions": []}
