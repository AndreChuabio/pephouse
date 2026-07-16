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
    # Data tiers to include: trial | quality | anecdote | synthetic. None = legacy
    # behaviour (trial when available, plus source_type/live_cohort if given).
    tiers: list[str] | None = None


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
    illustrative: bool = False  # anecdote-tier band: not a prediction, shown low-confidence
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
    run_id: int | None = None  # persisted simulation_runs row, for recall / recent list
    tiers_requested: list[str] | None = None
    tiers_used: list[str] = Field(default_factory=list)
    tier_notes: list[str] = Field(default_factory=list)


class EvidenceSource(BaseModel):
    """One toggleable evidence layer for the Arena 2 evidence map.

    display_tier follows the Arena 2 UI convention (4 = strongest / RCT,
    1 = weakest / anecdote), independent of the DB's data_tier enum name.
    """

    id: str
    label: str
    data_tier: str
    display_tier: int
    count: int
    available: bool


class SimulationDataResponse(BaseModel):
    compound_id: int
    name: str
    drug_class: str | None = None
    fda_status: str | None = None
    approved: bool = False
    summary: str | None = None
    evidence_sources: list[EvidenceSource] = Field(default_factory=list)
    outcome_names: list[str] = Field(default_factory=list)
    studied_age_min: int | None = None
    studied_age_max: int | None = None
    cohort_total: int = 0
    tables: dict[str, list[dict]] = Field(default_factory=dict)


# --------------------------------------------------------- import / user data
# Persisted patient data a user connected (wearable / bloodwork) or reported.
# Mirrors the Junction ProfilePatch shape so a live import and a mock are
# interchangeable. ImportSource/LabValue are shared by the Junction import API
# (/import/*) and the user-data store (GET/POST /users/{user_ref}/data).


class ImportSource(BaseModel):
    kind: str | None = None  # device | bloodwork | upload
    label: str | None = None
    at: str | None = None  # ISO timestamp


class LabValue(BaseModel):
    name: str
    slug: str | None = None
    value: float | str | None = None
    unit: str | None = None
    flag: str | None = None
    status: str | None = None  # optimal | high | low | abnormal
    ref_low: float | None = None
    ref_high: float | None = None


class WearableMetric(BaseModel):
    calendar_date: str
    steps: int | None = None
    resting_hr: int | None = None
    hrv_ms: float | None = None
    sleep_hours: float | None = None
    calories: int | None = None
    weight_kg: float | None = None
    provider: str | None = None


# ---- Junction import API (/import/*) ----


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


# ---- User-data store (GET/POST /users/{user_ref}/data) ----


class UserDataPatch(BaseModel):
    """Body for POST /users/{user_ref}/data — a connected/reported patch."""

    age: int | None = None
    sex: str | None = None  # M | F
    weight_kg: float | None = None
    conditions: list[str] | None = None
    goals: list[str] | None = None
    labs: list[LabValue] | None = None
    wearable: list[WearableMetric] | None = None
    source: ImportSource | None = None


class UserDataBundle(BaseModel):
    """Response for GET/POST /users/{user_ref}/data — the full stored bundle."""

    user_ref: str
    connected: bool = False
    age: int | None = None
    sex: str | None = None
    weight_kg: float | None = None
    conditions: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    source: ImportSource | None = None
    labs: list[LabValue] = Field(default_factory=list)
    wearable: list[WearableMetric] = Field(default_factory=list)


class InteractionPair(BaseModel):
    compound_a_id: int
    compound_a_name: str
    compound_b_id: int
    compound_b_name: str
    severity: str  # 'major' | 'moderate' | 'minor' | 'unknown'
    mechanism: str | None = None
    management: str | None = None
    source_url: str | None = None
    source_kind: str  # 'drugbank_pubchem' | 'curated' | 'no_data'


class InteractionsResponse(BaseModel):
    pairs: list[InteractionPair] = Field(default_factory=list)


# ------------------------------------------------------------- twin simulate
# One endpoint that takes the Digital Twin's full payload — the patient (or a
# saved user_ref to pull from user_profiles), the selected compound stack, and
# the simulation controls — and runs the Monte Carlo over it.


class TwinSimulateRequest(BaseModel):
    user_ref: str | None = None  # when given (and patient omitted), load the saved profile
    patient: PatientProfile | None = None
    compounds: list[int] = Field(default_factory=list)  # registry compound ids
    outcomes: list[str] = Field(default_factory=lambda: ["weight_change_pct"])
    tiers: list[str] | None = None  # trial | quality | anecdote | synthetic
    source_type: str | None = None  # compounding_pharmacy | vendor_tested | gray_market | ...
    n_draws: int = 5000
    seed: int = 42


# --------------------------------------------------------------- user stack
# The compounds a user has added to their stack (Digital Twin), with dose +
# source. Backed by the user_stack table (see db/user_stack.sql).


class StackAddRequest(BaseModel):
    compound_id: int
    compound_name: str | None = None
    dose: str | None = None
    source_type: str | None = None


class StackItem(BaseModel):
    id: int
    compound_id: int
    compound_name: str | None = None
    dose: str | None = None
    source_type: str | None = None
    created_at: str | None = None


# ------------------------------------------------------------------- consult
# The Consult layer (Tavus CVI). A session mints a Tavus conversation seeded with
# a PHI-minimized context; three tool-backing endpoints answer conversation
# tool_call events the frontend forwards over the Daily data channel; an intake
# captures a trial-referral row; a lab PDF upload extracts biomarkers.


class ConsultSessionRequest(BaseModel):
    """Body for POST /consult/session.

    ``user_ref`` (when given) loads the stored bundle and PHI-minimizes it into
    the conversational context. ``goal`` / ``compound_name`` frame the consult.
    """

    user_ref: str | None = None
    goal: str | None = None
    compound_name: str | None = None


class ConsultSessionResponse(BaseModel):
    conversation_url: str
    conversation_id: str
    pal_id: str


class CompoundEvidenceRequest(BaseModel):
    """Body for the get_compound_evidence tool call."""

    compound_name: str
    demographic: str | None = None


class ScreenEligibilityRequest(BaseModel):
    """Body for the screen_eligibility tool call."""

    age: int
    sex: str  # M | F
    weight_kg: float | None = None
    compound_name: str
    conditions: list[str] | None = None


# Allowed eligibility reads (mirrors the trial_intakes.eligibility CHECK).
ELIGIBILITY_VALUES = ("eligible", "excluded", "no_trial", "unknown")


class TrialIntake(BaseModel):
    """Body for POST /consult/intake — a trial-referral capture after the consult.

    PHI minimization: ``context_snapshot`` must hold only the minimized triage
    context a coordinator needs (flags / ranges / goal), never raw lab values,
    identifiers, or contact details.
    """

    user_ref: str
    goal: str | None = None
    compound_name: str | None = None
    eligibility: str  # eligible | excluded | no_trial | unknown
    eligibility_reason: str | None = None
    consent: bool = False
    context_snapshot: dict | None = None
    counsel_summary: str | None = None


class IntakeResult(BaseModel):
    id: int | None = None
    status: str


class LabUploadResponse(BaseModel):
    connected: bool
    extracted_count: int


# ---- Vendor registry (GET /vendors, POST /vendors/submissions) ----------------
# The vendor index is an education surface. Nothing here carries a price, a bid,
# or a placement: a vendor can submit data and be listed, and that is all the
# relationship there is. Submissions are CLAIMS until an independent assay backs
# them, and the API keeps that distinction rather than flattening it.


class VendorSubmission(BaseModel):
    """Body for POST /vendors/submissions — a vendor disclosing itself, or a
    member reporting a source they buy from.

    Lands as `pending`. Nothing is published unreviewed: an open write path into
    a public index invites a vendor to inflate itself with an invented COA, a
    competitor to smear a rival with an invented failure, and a vendor to flood
    its own page with five-star reports.
    """

    vendor_name: str
    # Set when adding to an EXISTING vendor from its page; the report/claim
    # attaches on publish without a name-match guess.
    vendor_id: int | None = None
    # 'vendor' = a self-disclosure/claim; 'member' = a buyer report.
    submission_kind: str = "vendor"
    manufacturer: str | None = None
    country: str | None = None
    # compounding_pharmacy | vendor_tested | gray_market | research_chem | brand
    source_type: str | None = None
    # Contact — a grey-market source may have only a channel, no website.
    website: str | None = None
    telegram: str | None = None
    whatsapp: str | None = None
    contact_other: str | None = None
    # Vendor-claim fields. A CLAIM by the submitter; only a third-party assay is
    # evidence of testing.
    third_party_tested: bool | None = None
    test_labs: list[str] | None = None
    coa_url: str | None = None
    gmp_certified: bool | None = None
    # Member-report fields (used when submission_kind == 'member').
    report_compound_id: int | None = None
    report_sentiment: str | None = None  # positive | neutral | negative
    report_cost_usd: float | None = None
    report_batch_lab_tested: bool | None = None
    submitted_by: str = "vendor"  # vendor | member | operator
    notes: str | None = None


class VendorSubmissionResult(BaseModel):
    id: int | None = None
    status: str


class VendorReview(BaseModel):
    """Body for the operator review of a pending submission."""

    status: str  # published | rejected
    review_note: str | None = None
    vendor_id: int | None = None


# ---- Stack report + billing --------------------------------------------------


class StackReportRequest(BaseModel):
    """Body for POST /report — the compounds a member is running."""

    compounds: list[int]


class CheckoutResponse(BaseModel):
    checkout_url: str


class BillingStatus(BaseModel):
    """Whether this member can open the paid report, and whether we can sell it."""

    has_access: bool
    configured: bool
    price_cents: int
    currency: str


class ConfirmRequest(BaseModel):
    session_id: str
