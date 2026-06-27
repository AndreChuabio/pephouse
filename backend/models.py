"""Request/response models for POST /simulate."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PatientProfile(BaseModel):
    age: int
    sex: str  # M | F
    weight_kg: float | None = None
    conditions: list[str] = Field(default_factory=list)


class CompoundInput(BaseModel):
    compound_id: int
    dose_label: str | None = None


class SimulateRequest(BaseModel):
    compounds: list[CompoundInput]
    patient: PatientProfile
    outcomes: list[str] = Field(default_factory=lambda: ["weight_change_pct"])
    n_draws: int = 5000
    horizon_months: int = 12
    seed: int = 42
    # SOURCE variance axis: where the peptide was made. None = label-dose (no source modeling).
    # compounding_pharmacy | vendor_tested | gray_market | research_chem | brand
    source_type: str | None = None
    # Run Synthea LIVE for a patient-matched cohort (falls back to the pre-loaded
    # synthetic_patients table on timeout/failure). Default uses the offline cohort.
    live_cohort: bool = False


class QuarterBand(BaseModel):
    q: int
    month: int
    p10: float
    p50: float
    p90: float


class OutcomeResult(BaseModel):
    compound_id: int
    outcome_name: str
    unit: str | None
    evidence_basis: str
    trial_backed: bool
    confidence: float
    distribution_void: bool = False
    mean: float | None = None  # delivered-effect mean (source-adjusted when source_type set)
    sd: float | None = None
    n: int | None = None
    p10: float | None = None
    p50: float | None = None
    p90: float | None = None
    prob_threshold: float | None = None
    # SOURCE axis outputs (null when source_type not supplied)
    biological_mean: float | None = None  # label-dose mean, before source adjustment
    source_type: str | None = None
    source_dud_pct: float | None = None  # P(near-inert "sugar water" lot), as a %
    quarters: list[QuarterBand] = Field(default_factory=list)


class ExcludedPrior(BaseModel):
    compound_id: int
    outcome_name: str
    reason: str


class AnecdoteSnippet(BaseModel):
    permalink: str | None
    claimed_effect: str | None
    sentiment: str | None


class SimulateResponse(BaseModel):
    cohort_n: int
    cohort_source: str = "preloaded"  # preloaded | synthea_live | synthea_live_failed_fallback
    cohort_gen_ms: int | None = None  # Synthea live generation time (ms) when used
    cohort_fallback: str | None = None
    cohort_callout: str | None = None
    substrate_missing: bool = False
    outcomes: list[OutcomeResult]
    excluded_priors: list[ExcludedPrior] = Field(default_factory=list)
    anecdotes: list[AnecdoteSnippet] = Field(default_factory=list)
    data_confidence: str
