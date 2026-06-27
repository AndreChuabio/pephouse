export type EvidenceTier = "gray-market" | "fda-approved";

export type ProvenanceTier = "anecdotal" | "trial";

export type Compound = {
  id: string;
  name: string;
  tier: EvidenceTier;
  description: string;
  dosage: string;
  dosagePercent: number;
};

export type ChartBar = {
  id: string;
  heightPercent: number;
  className: string;
  highlight?: boolean;
  tooltip?: string;
};

export type MetricTone = "default" | "warning" | "confidence";

export type MetricCard = {
  id: string;
  icon: string;
  label: string;
  value: string;
  detail?: string;
  note?: string;
  tone?: MetricTone;
  progressPercent?: number;
  confidenceLevel?: 1 | 2 | 3;
};

export type ProvenanceSource = {
  id: string;
  icon: string;
  label: string;
  meta: string;
  tier?: ProvenanceTier;
};

export type Demographics = {
  age: number;
  sex: "M" | "F";
  weightKg: number;
};

// ---- Patient data import (Junction wearable + bloodwork) ----

export type ImportKind = "device" | "bloodwork" | "upload" | "reported";

export type ImportSource = {
  kind: ImportKind;
  label: string;
  at: string; // ISO timestamp
};

export type LabStatus = "optimal" | "high" | "low" | "abnormal";

export type LabValue = {
  name: string;
  value: number | string | null;
  unit?: string | null;
  flag?: string | null;
  status?: LabStatus | null;
  ref_low?: number | null;
  ref_high?: number | null;
};

/** Normalized (camelCase) patch every import path returns; merged into PatientInput. */
export type ImportPatch = {
  age?: number;
  sex?: "M" | "F";
  weightKg?: number;
  conditions?: string[];
  labs?: LabValue[];
  source: ImportSource;
};

export type PatientInput = Demographics & {
  conditions?: string[];
  labs?: LabValue[];
  importSource?: ImportSource;
};

export type SimulateRequest = {
  compounds: { compound_id: number; dose_label?: string }[];
  patient: { age: number; sex: string; weight_kg: number; conditions?: string[] };
  outcomes: string[];
  n_draws?: number;
  horizon_months?: number;
  seed?: number;
  // SOURCE axis: compounding_pharmacy | vendor_tested | gray_market | research_chem | brand
  source_type?: string;
  // Run Synthea live for a patient-matched cohort (~7s); falls back to the pre-loaded cohort.
  live_cohort?: boolean;
  // Data tiers to include: trial | quality | anecdote | synthetic
  tiers?: string[];
};

export type QuarterBand = {
  q: number;
  month: number;
  p10: number;
  p50: number;
  p90: number;
};

export type OutcomeResult = {
  compound_id: number;
  outcome_name: string;
  unit: string | null;
  evidence_basis: string;
  trial_backed: boolean;
  confidence: number;
  distribution_void: boolean;
  mean?: number | null;
  sd?: number | null;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  prob_threshold?: number | null;
  biological_mean?: number | null;
  source_type?: string | null;
  source_dud_pct?: number | null;
  illustrative?: boolean;
  quarters: QuarterBand[];
};

export type SimulateResponse = {
  cohort_n: number;
  cohort_source?: string;
  cohort_gen_ms?: number | null;
  cohort_fallback?: string | null;
  cohort_callout?: string | null;
  substrate_missing: boolean;
  outcomes: OutcomeResult[];
  excluded_priors: { compound_id: number; outcome_name: string; reason: string }[];
  anecdotes: { permalink?: string | null; claimed_effect?: string | null; sentiment?: string | null }[];
  data_confidence: string;
  tiers_used?: string[];
  tier_notes?: string[];
};
