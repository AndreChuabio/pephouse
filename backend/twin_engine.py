"""Monte Carlo twin engine — bodies from synthetic_patients, effects from outcome_priors."""

from __future__ import annotations

import numpy as np

import db
from models import (
    AnecdoteSnippet,
    CompoundInput,
    ExcludedPrior,
    OutcomeResult,
    PatientProfile,
    QuarterBand,
    SimulateResponse,
)

MIN_COHORT = 3
QUARTER_MONTHS = (3, 6, 9, 12)
QUARTER_RAMP = (0.25, 0.55, 0.80, 1.0)
WEIGHT_LOSS_THRESHOLD = -15.0
SUBSTRATE_SD_INFLATE = 1.25


def _parse_int(text) -> int | None:
    if text is None or text == "":
        return None
    s = str(text).strip()
    return int(s) if s.isdigit() else None


def _sex_matches(patient_sex: str, prior_sex) -> bool:
    if prior_sex is None or str(prior_sex).upper() in ("", "ALL", "ANY"):
        return True
    p = patient_sex.upper()[0]
    g = str(prior_sex).upper()
    if g in ("M", "MALE"):
        return p == "M"
    if g in ("F", "FEMALE"):
        return p == "F"
    return True


def _patient_sex_matches_row(patient_sex: str, row_sex: str | None) -> bool:
    if not row_sex:
        return True
    p = patient_sex.upper()[0]
    r = row_sex.lower()
    return (p == "M" and r == "male") or (p == "F" and r == "female")


def check_eligibility(patient: PatientProfile, prior: dict) -> str | None:
    min_age = _parse_int(prior.get("min_age"))
    max_age = _parse_int(prior.get("max_age"))
    if min_age is not None and patient.age < min_age:
        return f"age {patient.age} below trial minimum ({min_age})"
    if max_age is not None and patient.age > max_age:
        return f"age {patient.age} above trial maximum ({max_age})"
    if not _sex_matches(patient.sex, prior.get("sex")):
        return f"sex {patient.sex} not in trial population ({prior.get('sex')})"
    return None


def match_cohort(patient: PatientProfile) -> list[dict]:
    rows = db.get_synthetic_patients()
    matched = []
    for row in rows:
        age = row.get("age")
        if age is not None and abs(int(age) - patient.age) > 5:
            continue
        if not _patient_sex_matches_row(patient.sex, row.get("sex")):
            continue
        matched.append(row)
    return matched


def _pick_cluster(clusters: list[dict], outcome_name: str) -> dict | None:
    if not clusters:
        return None
    for c in clusters:
        label = (c.get("cluster_label") or "").lower()
        if outcome_name.lower() in label:
            return c
    trial = [c for c in clusters if c.get("trial_backed")]
    return trial[0] if trial else clusters[0]


def _percentiles(draws: np.ndarray) -> tuple[float, float, float]:
    return float(np.percentile(draws, 10)), float(np.percentile(draws, 50)), float(np.percentile(draws, 90))


def _quarter_bands(terminal: np.ndarray) -> list[QuarterBand]:
    quarters = []
    for i, (month, ramp) in enumerate(zip(QUARTER_MONTHS, QUARTER_RAMP), start=1):
        scaled = terminal * ramp
        p10, p50, p90 = _percentiles(scaled)
        quarters.append(QuarterBand(q=i, month=month, p10=round(p10, 2), p50=round(p50, 2), p90=round(p90, 2)))
    return quarters


def _simulate_trial_outcome(
    compound_id: int,
    outcome_name: str,
    prior: dict,
    cluster: dict | None,
    patient: PatientProfile,
    n_draws: int,
    seed: int,
    cohort_n: int,
    substrate_missing: bool,
) -> OutcomeResult:
    mean = float(prior["effect_mean"])
    sd = float(prior["effect_sd"] or 0)
    if substrate_missing:
        sd *= SUBSTRATE_SD_INFLATE

    rng = np.random.default_rng(seed)
    terminal = rng.normal(mean, sd, n_draws)

    p10, p50, p90 = _percentiles(terminal)
    confidence = float(cluster["confidence"]) if cluster else 0.65
    if substrate_missing:
        confidence = min(confidence, 0.52)

    threshold = WEIGHT_LOSS_THRESHOLD if "weight" in outcome_name else mean - abs(sd)
    prob = float(np.mean(terminal <= threshold))

    return OutcomeResult(
        compound_id=compound_id,
        outcome_name=outcome_name,
        unit=prior.get("unit"),
        evidence_basis="trial" if cluster and cluster.get("trial_backed") else "anecdote",
        trial_backed=bool(cluster.get("trial_backed")) if cluster else True,
        confidence=round(confidence, 2),
        distribution_void=False,
        mean=round(mean, 2),
        sd=round(sd, 2),
        n=int(prior.get("population_n") or n_draws),
        p10=round(p10, 2),
        p50=round(p50, 2),
        p90=round(p90, 2),
        prob_threshold=round(prob, 3),
        quarters=_quarter_bands(terminal),
    )


def _void_outcome(compound_id: int, outcome_name: str, cluster: dict | None) -> OutcomeResult:
    conf = float(cluster["confidence"]) if cluster else 0.38
    return OutcomeResult(
        compound_id=compound_id,
        outcome_name=outcome_name,
        unit=None,
        evidence_basis="anecdote",
        trial_backed=False,
        confidence=round(conf, 2),
        distribution_void=True,
        quarters=[],
    )


def run_simulation(
    compounds: list[CompoundInput],
    patient: PatientProfile,
    outcomes: list[str],
    n_draws: int,
    seed: int,
) -> SimulateResponse:
    cohort = match_cohort(patient)
    cohort_n = len(cohort)
    substrate_missing = cohort_n < MIN_COHORT

    cohort_fallback = None
    cohort_callout = None
    anecdotes: list[AnecdoteSnippet] = []

    if substrate_missing:
        cohort_fallback = "anecdote"
        cohort_callout = (
            f"Only {cohort_n} Tier-4 patient(s) matched age±5 and sex in synthetic_patients — "
            "Reddit anecdotes below are context only, not evidence."
        )

    result_outcomes: list[OutcomeResult] = []
    excluded: list[ExcludedPrior] = []

    for compound in compounds:
        clusters = db.get_case_studies(compound.compound_id)
        priors = db.get_outcome_priors(compound.compound_id)
        priors_by_name = {p["outcome_name"]: p for p in priors}

        for outcome_name in outcomes:
            cluster = _pick_cluster(clusters, outcome_name)
            prior = priors_by_name.get(outcome_name)

            if prior is None:
                result_outcomes.append(_void_outcome(compound.compound_id, outcome_name, cluster))
                if substrate_missing and not anecdotes:
                    anecdotes = _anecdote_snippets(compound.compound_id)
                continue

            reason = check_eligibility(patient, prior)
            if reason:
                excluded.append(
                    ExcludedPrior(
                        compound_id=compound.compound_id,
                        outcome_name=outcome_name,
                        reason=reason,
                    )
                )
                continue

            result_outcomes.append(
                _simulate_trial_outcome(
                    compound.compound_id,
                    outcome_name,
                    prior,
                    cluster,
                    patient,
                    n_draws,
                    seed + compound.compound_id,
                    cohort_n,
                    substrate_missing,
                )
            )

    if substrate_missing and not anecdotes and compounds:
        anecdotes = _anecdote_snippets(compounds[0].compound_id)

    has_trial = any(o.trial_backed and not o.distribution_void for o in result_outcomes)
    data_confidence = "High" if has_trial and not substrate_missing else "Low"

    return SimulateResponse(
        cohort_n=cohort_n,
        cohort_fallback=cohort_fallback,
        cohort_callout=cohort_callout,
        substrate_missing=substrate_missing,
        outcomes=result_outcomes,
        excluded_priors=excluded,
        anecdotes=anecdotes,
        data_confidence=data_confidence,
    )


def _anecdote_snippets(compound_id: int, limit: int = 5) -> list[AnecdoteSnippet]:
    rows = db.get_anecdotes(compound_id, limit=limit)
    return [
        AnecdoteSnippet(
            permalink=r.get("permalink"),
            claimed_effect=r.get("claimed_effect"),
            sentiment=r.get("sentiment"),
        )
        for r in rows
    ]
