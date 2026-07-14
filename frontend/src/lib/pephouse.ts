import { apiFetch, apiJson } from "./http";

// Typed client for the vendor index, the stack report, and billing.
//
// Two things in these types are load-bearing rather than cosmetic:
//
//   TestingStatus separates an independent third-party assay from a vendor's own
//   claim about itself. They must never render the same way. A vendor saying it
//   is tested is not evidence that it is.
//
//   InteractionPair.hasData separates "we checked and found no interaction" from
//   "we have no data". Rendering an empty interaction table as safety would be a
//   lie with a needle attached to it.

// ---------------------------------------------------------------- vendor index

/** How strong a vendor's testing evidence is, graded by who produced it. */
export type TestingStatus = "independent" | "vendor_claim" | "none";

/** The axes a peptide can be tested on. Which ones were actually covered. */
export interface TestedAxes {
  purity: boolean;
  identity: boolean;
  potency: boolean;
  endotoxin: boolean;
  heavy_metals: boolean;
  sterility: boolean;
}

/** The name of a safety axis with no result on file. */
export type SafetyAxis = "endotoxin" | "heavy_metals" | "sterility";

export interface VendorSummary {
  id: number;
  name: string | null;
  manufacturer: string | null;
  country: string | null;
  source_type: string | null;
  gmp_certified: boolean | null;
  fda_green_list: boolean | null;
  cost_tier: string | null;
  testing_status: TestingStatus;
  independent_assays: number;
  vendor_claims: number;
  member_reports: number;
  /**
   * Which axes actually have a result. "Tested" is not a boolean.
   *
   * A grey-market COA is almost always purity plus identity — the axis that
   * barely varies, sitting at 98.7 to 99.95 percent across the whole market. The
   * axes that put people in hospital are the ones nobody publishes: independent
   * analysis has found arsenic and lead at up to ten times the parenteral limit,
   * and endotoxin in every sample of one 2024 series. A vendor waving a 99.8
   * percent purity certificate is showing you the number that was never going to
   * be bad.
   */
  tested_axes: TestedAxes;
  /** Safety axes with no result. An empty purity-only COA leaves all three here. */
  safety_gap: SafetyAxis[];
}

/** An independent third-party assay. The only thing that counts as evidence. */
export interface IndependentAssay {
  compound_id: number | null;
  purity_pct: number | null;
  label_mg: number | null;
  tested_mg: number | null;
  potency_factor: number | null;
  identity_verified: boolean | null;
  endotoxin_detected: boolean | null;
  heavy_metals_detected: boolean | null;
  sterility_pass: boolean | null;
  failed: boolean | null;
  fail_reason: string | null;
  test_lab: string | null;
  test_method: string | null;
  test_date: string | null;
  source_url: string | null;
}

/** What the vendor says about itself. A claim, not a measurement. */
export interface VendorClaim {
  submitted_at: string | null;
  third_party_tested: boolean | null;
  test_labs: string[];
  coa_url: string | null;
  gmp_certified: boolean | null;
  notes: string | null;
}

export interface MemberReport {
  compound_id: number | null;
  tested_purity_pct: number | null;
  batch_lab_tested: boolean | null;
  cost_usd: number | null;
  sentiment: string | null;
  notes: string | null;
  reported_at: string | null;
}

export interface SourcingRow {
  compound_id: number | null;
  source_type: string | null;
  origin_country: string | null;
  ships_from: string[];
  payment: string | null;
  notes: string | null;
}

export interface VendorBreakdown {
  id: number;
  name: string | null;
  manufacturer: string | null;
  country: string | null;
  source_type: string | null;
  website: string | null;
  // Contact channels. Many grey-market sources operate on Telegram or WhatsApp
  // and have no website; a missing website is not a gap for them.
  telegram: string | null;
  whatsapp: string | null;
  contact_other: string | null;
  gmp_certified: boolean | null;
  fda_green_list: boolean | null;
  fda_dmf: string | null;
  cost_tier: string | null;
  cost_per_vial_usd: number | null;
  cost_multiple_vs_gray: number | null;
  notes: string | null;
  testing_status: TestingStatus;
  tested_axes: TestedAxes;
  safety_gap: SafetyAxis[];
  independent_assays: IndependentAssay[];
  vendor_claims: VendorClaim[];
  member_reports: MemberReport[];
  sourcing: SourcingRow[];
}

export async function fetchVendors(): Promise<VendorSummary[]> {
  return apiJson<VendorSummary[]>("/vendors");
}

export async function fetchVendor(id: number): Promise<VendorBreakdown> {
  return apiJson<VendorBreakdown>(`/vendors/${id}`);
}

// ----------------------------------------------------------- vendor onboarding

export interface VendorSubmissionInput {
  vendor_name: string;
  /** Set when adding to an existing vendor from its page. */
  vendor_id?: number;
  /** "vendor" = a self-disclosure/claim, "member" = a buyer report. */
  submission_kind?: "vendor" | "member";
  manufacturer?: string;
  country?: string;
  source_type?: string;
  // Contact — a grey-market source may have only a channel, no website.
  website?: string;
  telegram?: string;
  whatsapp?: string;
  contact_other?: string;
  // Vendor-claim fields.
  third_party_tested?: boolean;
  test_labs?: string[];
  coa_url?: string;
  gmp_certified?: boolean;
  // Member-report fields (submission_kind === "member").
  report_compound_id?: number;
  report_sentiment?: "positive" | "neutral" | "negative";
  report_cost_usd?: number;
  report_batch_lab_tested?: boolean;
  submitted_by?: "vendor" | "member" | "operator";
  notes?: string;
}

export interface VendorSubmissionResult {
  id: number | null;
  status: string;
}

export async function submitVendor(
  input: VendorSubmissionInput,
): Promise<VendorSubmissionResult> {
  return apiJson<VendorSubmissionResult>("/vendors/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface PendingSubmission extends VendorSubmissionInput {
  id: number;
  created_at: string;
  status: string;
  submitter_ref: string | null;
}

export async function fetchPendingSubmissions(): Promise<PendingSubmission[]> {
  return apiJson<PendingSubmission[]>("/vendors/submissions?status=pending");
}

export async function reviewSubmission(
  id: number,
  status: "published" | "rejected",
  reviewNote?: string,
): Promise<{ id: number; status: string; vendor_id: number | null }> {
  return apiJson(`/vendors/submissions/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, review_note: reviewNote ?? null }),
  });
}

// ---------------------------------------------------------------- stack report

/** 4 = completed clinical trials, 3 = papers, 2 = source/lab data, 1 = anecdote, 0 = nothing. */
export type EvidenceTier = 0 | 1 | 2 | 3 | 4;

export type Verdict =
  | "trial_backed"
  | "observational_only"
  | "source_data_only"
  | "anecdote_only"
  | "no_evidence";

export interface LadderRung {
  tier: number;
  label: string;
  count: number;
  available: boolean;
}

export interface TrialRow {
  nct_id: string | null;
  phase: string | null;
  status: string | null;
  n_participants: number | null;
  source_url: string | null;
}

export interface CompoundSection {
  compound_id: number;
  name: string;
  drug_class: string | null;
  fda_status: string | null;
  approved: boolean;
  summary: string | null;
  evidence_ladder: LadderRung[];
  top_tier: EvidenceTier;
  verdict: Verdict;
  verdict_text: string;
  /** Trials that finished. These, and only these, are evidence. */
  completed_trials: TrialRow[];
  /** Registered but unfinished. Worth knowing, never evidence. */
  trials_in_progress: TrialRow[];
  trials_note: string | null;
  research_papers: number;
  case_studies: number;
  anecdotes: number;
  lab_results: number;
}

export interface InteractionPair {
  compound_a_id: number;
  compound_a_name: string | null;
  compound_b_id: number;
  compound_b_name: string | null;
  severity: "major" | "moderate" | "minor" | "unknown";
  mechanism: string | null;
  management: string | null;
  /** False means we have no data. It does NOT mean the pair is safe. */
  has_data: boolean;
}

export interface Interactions {
  pairs: InteractionPair[];
  pairs_with_data: number;
  pairs_without_data: number;
  note: string | null;
}

export interface StackSummary {
  total: number;
  trial_backed: string[];
  observational_only: string[];
  source_data_only: string[];
  anecdote_only: string[];
  no_evidence: string[];
  headline: string;
}

export interface StackReport {
  compounds: CompoundSection[];
  interactions: Interactions;
  unknown_compound_ids: number[];
  summary: StackSummary;
}

/** The free teaser: the verdict, without the evidence behind it. */
export interface StackPreview {
  summary: StackSummary;
  compounds: Pick<
    CompoundSection,
    "compound_id" | "name" | "top_tier" | "verdict" | "verdict_text"
  >[];
  locked: string[];
}

export async function previewReport(compounds: number[]): Promise<StackPreview> {
  return apiJson<StackPreview>("/report/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compounds }),
  });
}

/** The paid report. Throws with status 402 when there is no entitlement. */
export async function fetchReport(compounds: number[]): Promise<StackReport> {
  const res = await apiFetch("/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compounds }),
  });
  if (res.status === 402) throw new PaymentRequiredError();
  if (!res.ok) throw new Error((await res.text()) || `report failed (${res.status})`);
  return res.json() as Promise<StackReport>;
}

export class PaymentRequiredError extends Error {
  constructor() {
    super("payment required");
    this.name = "PaymentRequiredError";
  }
}

// --------------------------------------------------------------------- billing

export interface BillingStatus {
  has_access: boolean;
  /** False when no Stripe key is set on the backend: we cannot take money at all. */
  configured: boolean;
  price_cents: number;
  currency: string;
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  return apiJson<BillingStatus>("/billing/status");
}

export async function startCheckout(): Promise<string> {
  const { checkout_url } = await apiJson<{ checkout_url: string }>("/billing/checkout", {
    method: "POST",
  });
  return checkout_url;
}

/** Confirm a Checkout session on return. Works before any webhook is configured. */
export async function confirmCheckout(sessionId: string): Promise<BillingStatus> {
  return apiJson<BillingStatus>("/billing/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}
