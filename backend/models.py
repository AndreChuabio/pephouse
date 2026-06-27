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
    mean: float | None = None
    sd: float | None = None
    n: int | None = None
    p10: float | None = None
    p50: float | None = None
    p90: float | None = None
    prob_threshold: float | None = None
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
    cohort_fallback: str | None = None
    cohort_callout: str | None = None
    substrate_missing: bool = False
    outcomes: list[OutcomeResult]
    excluded_priors: list[ExcludedPrior] = Field(default_factory=list)
    anecdotes: list[AnecdoteSnippet] = Field(default_factory=list)
    data_confidence: str


# ----------------------------------------------------------------- import API
# Patient-data import (Junction wearable + bloodwork). Every import path returns
# the same ImportSource-stamped patch that the frontend merges into `patient`.


class ImportSource(BaseModel):
    kind: str  # device | bloodwork | upload
    label: str
    at: str  # ISO timestamp


class LabValue(BaseModel):
    name: str
    value: float | str | None = None
    unit: str | None = None
    flag: str | None = None


class ProfilePatch(BaseModel):
    age: int | None = None
    sex: str | None = None  # M | F
    weight_kg: float | None = None
    conditions: list[str] = Field(default_factory=list)
    labs: list[LabValue] = Field(default_factory=list)
    source: ImportSource


class LinkRequest(BaseModel):
    user_ref: str


class LinkResponse(BaseModel):
    user_id: str
    link_url: str


class ProfileResponse(BaseModel):
    connected: bool
    patch: ProfilePatch | None = None
