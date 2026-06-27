"""Monte Carlo twin engine — bodies from synthetic_patients, effects from outcome_priors."""

from __future__ import annotations

import time

import numpy as np

import db
import modules
import runs
import synthea_live
from tiers import TIER_NAMES, availability as tier_availability, confidence_cap as tier_cap, resolve as tier_resolve
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
ANECDOTE_WIDEN = 1.5  # extra SD when the anecdote tier is layered on a trial distribution


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


def _filter_cohort(patient: PatientProfile, rows: list[dict]) -> list[dict]:
    matched = []
    for row in rows:
        age = row.get("age")
        if age is not None and abs(int(age) - patient.age) > 5:
            continue
        if not _patient_sex_matches_row(patient.sex, row.get("sex")):
            continue
        matched.append(row)
    return matched


def match_cohort(patient: PatientProfile) -> list[dict]:
    """Pre-loaded Tier-4 cohort filtered to the patient (age +/-5, sex)."""
    return _filter_cohort(patient, db.get_synthetic_patients())


def resolve_cohort(patient: PatientProfile, live: bool, module: dict | None = None) -> tuple[list[dict], str, int | None]:
    """Return (cohort, source, gen_ms). live=True runs Synthea per request (loading
    the compound module if given), falling back to the pre-loaded cohort on failure."""
    if not live:
        return match_cohort(patient), "preloaded", None
    t0 = time.time()
    bodies = synthea_live.generate_cohort(patient.age, patient.sex, module=module)
    gen_ms = int((time.time() - t0) * 1000)
    if bodies:
        return _filter_cohort(patient, bodies), "synthea_live", gen_ms
    return match_cohort(patient), "synthea_live_failed_fallback", gen_ms


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


def _draw_potency(sp: dict, n_draws: int, rng: np.random.Generator) -> np.ndarray:
    """The SOURCE axis: delivered/label potency as a mixture.

    Most lots ~ N(potency_mean, potency_sd); a p_fail fraction are near-inert
    "sugar water" lots ~ N(fail_mean, fail_sd). This is what makes a gray-market
    twin's curve widen AND grow a fat left tail vs a compounding pharmacy.
    """
    mean = float(sp.get("potency_mean") or 1.0)
    sd = float(sp.get("potency_sd") or 0.0)
    p_fail = float(sp.get("p_fail") or 0.0)
    fail_mean = 0.5 if sp.get("fail_mean") is None else float(sp.get("fail_mean"))
    fail_sd = 0.15 if sp.get("fail_sd") is None else float(sp.get("fail_sd"))
    good = rng.normal(mean, sd, n_draws)
    bad = rng.normal(fail_mean, fail_sd, n_draws)
    is_fail = rng.random(n_draws) < p_fail
    return np.clip(np.where(is_fail, bad, good), 0.0, None)


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
    source_prior: dict | None = None,
    anecdote_widen: bool = False,
    conf_cap: float = 1.0,
) -> OutcomeResult:
    bio_mean = float(prior["effect_mean"])
    sd = float(prior["effect_sd"] or 0)
    if substrate_missing:
        sd *= SUBSTRATE_SD_INFLATE
    if anecdote_widen:
        sd *= ANECDOTE_WIDEN  # anecdote tier adds real-world uncertainty on top of the trial prior

    rng = np.random.default_rng(seed)
    terminal = rng.normal(bio_mean, sd, n_draws)

    # SOURCE axis: delivered_effect = biological_effect x potency_factor.
    source_type = None
    source_dud_pct = None
    if source_prior:
        terminal = terminal * _draw_potency(source_prior, n_draws, rng)
        source_type = source_prior.get("source_type")
        p_fail = float(source_prior.get("p_fail") or 0.0)
        p_contam = float(source_prior.get("p_contam") or 0.0)
        source_dud_pct = round(p_fail * 100, 1)

    p10, p50, p90 = _percentiles(terminal)
    confidence = float(cluster["confidence"]) if cluster else 0.65
    if substrate_missing:
        confidence = min(confidence, 0.52)
    if source_prior:
        # a sketchy source is itself uncertainty -> penalize confidence
        confidence *= max(0.4, 1.0 - (p_fail + p_contam))
    confidence = min(confidence, conf_cap)  # weakest included tier caps confidence

    threshold = WEIGHT_LOSS_THRESHOLD if "weight" in outcome_name else bio_mean - abs(sd)
    prob = float(np.mean(terminal <= threshold))

    return OutcomeResult(
        compound_id=compound_id,
        outcome_name=outcome_name,
        unit=prior.get("unit"),
        evidence_basis="trial+anecdote" if anecdote_widen else ("trial" if cluster and cluster.get("trial_backed") else "anecdote"),
        trial_backed=bool(cluster.get("trial_backed")) if cluster else True,
        confidence=round(confidence, 2),
        distribution_void=False,
        mean=round(float(np.mean(terminal)), 2),
        sd=round(float(np.std(terminal)), 2),
        n=int(prior.get("population_n") or n_draws),
        p10=round(p10, 2),
        p50=round(p50, 2),
        p90=round(p90, 2),
        prob_threshold=round(prob, 3),
        biological_mean=round(bio_mean, 2),
        source_type=source_type,
        source_dud_pct=source_dud_pct,
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


def _simulate_anecdote_outcome(
    compound_id: int, outcome_name: str, source_prior: dict | None,
    n_draws: int, seed: int, conf_cap: float,
) -> OutcomeResult:
    """Anecdote tier: an ILLUSTRATIVE band from sentiment-skewed reports. Flagged
    illustrative + very low confidence; never presented as a trial prediction."""
    dist = modules.anecdote_distribution(compound_id)
    if dist is None:
        return _void_outcome(compound_id, outcome_name, None)
    mean, sd = dist
    rng = np.random.default_rng(seed)
    terminal = rng.normal(mean, sd, n_draws)

    source_type = None
    source_dud_pct = None
    if source_prior:
        terminal = terminal * _draw_potency(source_prior, n_draws, rng)
        source_type = source_prior.get("source_type")
        source_dud_pct = round(float(source_prior.get("p_fail") or 0.0) * 100, 1)

    p10, p50, p90 = _percentiles(terminal)
    threshold = WEIGHT_LOSS_THRESHOLD if "weight" in outcome_name else mean - abs(sd)
    prob = float(np.mean(terminal <= threshold))
    return OutcomeResult(
        compound_id=compound_id,
        outcome_name=outcome_name,
        unit="%",
        evidence_basis="anecdote",
        trial_backed=False,
        confidence=round(min(0.3, conf_cap), 2),
        distribution_void=False,
        illustrative=True,
        mean=round(float(np.mean(terminal)), 2),
        sd=round(float(np.std(terminal)), 2),
        p10=round(p10, 2),
        p50=round(p50, 2),
        p90=round(p90, 2),
        prob_threshold=round(prob, 3),
        source_type=source_type,
        source_dud_pct=source_dud_pct,
        quarters=_quarter_bands(terminal),
    )


def run_simulation(
    compounds: list[CompoundInput],
    patient: PatientProfile,
    outcomes: list[str],
    n_draws: int,
    seed: int,
    source_type: str | None = None,
    live_cohort: bool = False,
    tiers: list[str] | None = None,
) -> SimulateResponse:
    explicit = tiers is not None
    eff_live = live_cohort or (explicit and "synthetic" in tiers)

    active_module = modules.get_active_module(compounds[0].compound_id) if (eff_live and compounds) else None
    cohort, cohort_source, cohort_gen_ms = resolve_cohort(patient, eff_live, active_module)
    cohort_n = len(cohort)
    substrate_missing = cohort_n < MIN_COHORT

    cohort_fallback = None
    cohort_callout = None
    anecdotes: list[AnecdoteSnippet] = []

    if cohort_source == "synthea_live":
        cohort_callout = f"Generated {cohort_n} patient-matched Synthea bodies live in {cohort_gen_ms} ms."

    if substrate_missing:
        cohort_fallback = "anecdote"
        cohort_callout = (
            f"Only {cohort_n} Tier-4 patient(s) matched age±5 and sex — "
            "Reddit anecdotes below are context only, not evidence."
        )

    result_outcomes: list[OutcomeResult] = []
    excluded: list[ExcludedPrior] = []
    tiers_used_all: list[str] = []
    tier_notes_all: list[str] = []

    for compound in compounds:
        cid = compound.compound_id
        avail = tier_availability(cid)
        used, notes = tier_resolve(tiers, avail)
        for t in used:
            if t not in tiers_used_all:
                tiers_used_all.append(t)
        tier_notes_all.extend(notes)

        use_quality = ("quality" in used) if explicit else (source_type is not None)
        source_prior = db.get_source_potency_prior(source_type, cid) if (use_quality and source_type) else None
        cap = tier_cap(used) if explicit else 1.0

        clusters = db.get_case_studies(cid)
        priors = db.get_outcome_priors(cid)
        priors_by_name = {p["outcome_name"]: p for p in priors}

        for outcome_name in outcomes:
            cluster = _pick_cluster(clusters, outcome_name)
            prior = priors_by_name.get(outcome_name)
            use_trial = ("trial" in used) if explicit else (prior is not None)
            use_anecdote = ("anecdote" in used) if explicit else False

            if use_trial and prior is not None:
                reason = check_eligibility(patient, prior)
                if reason:
                    excluded.append(ExcludedPrior(compound_id=cid, outcome_name=outcome_name, reason=reason))
                    continue
                result_outcomes.append(
                    _simulate_trial_outcome(
                        cid, outcome_name, prior, cluster, patient, n_draws, seed + cid,
                        cohort_n, substrate_missing, source_prior,
                        anecdote_widen=use_anecdote, conf_cap=cap,
                    )
                )
            elif use_anecdote and avail["anecdote"]["available"]:
                result_outcomes.append(
                    _simulate_anecdote_outcome(cid, outcome_name, source_prior, n_draws, seed + cid, cap)
                )
                if not anecdotes:
                    anecdotes = _anecdote_snippets(cid)
            else:
                result_outcomes.append(_void_outcome(cid, outcome_name, cluster))
                if (substrate_missing or use_anecdote) and not anecdotes:
                    anecdotes = _anecdote_snippets(cid)

    if substrate_missing and not anecdotes and compounds:
        anecdotes = _anecdote_snippets(compounds[0].compound_id)

    has_trial = any(o.trial_backed and not o.distribution_void for o in result_outcomes)
    data_confidence = "High" if (has_trial and not substrate_missing and "anecdote" not in tiers_used_all) else "Low"
    tiers_used = [t for t in TIER_NAMES if t in tiers_used_all]

    response = SimulateResponse(
        cohort_n=cohort_n,
        cohort_source=cohort_source,
        cohort_gen_ms=cohort_gen_ms,
        cohort_fallback=cohort_fallback,
        cohort_callout=cohort_callout,
        substrate_missing=substrate_missing,
        outcomes=result_outcomes,
        excluded_priors=excluded,
        anecdotes=anecdotes,
        data_confidence=data_confidence,
        tiers_requested=tiers,
        tiers_used=tiers_used,
        tier_notes=tier_notes_all,
    )

    # Persist the run (best-effort). Save the live-generated bodies only.
    response.run_id = runs.save_run(
        compound_id=compounds[0].compound_id if compounds else None,
        patient=patient.model_dump(),
        source_type=source_type,
        n_draws=n_draws,
        live_cohort=eff_live,
        cohort_source=cohort_source,
        cohort_n=cohort_n,
        cohort_gen_ms=cohort_gen_ms,
        data_confidence=data_confidence,
        outcomes=[o.model_dump() for o in result_outcomes],
        cohort=cohort if cohort_source == "synthea_live" else None,
    )
    return response


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
