/**
 * Bridges the Arena (Simulation 2) node-builder to the real backend POST /simulate.
 * Run Execution sends the WHOLE stack + each compound's real outcomes, and the report
 * shows the live Monte-Carlo band + a weakest-link confidence (so adding a compound or
 * a weak-evidence stack moves the number honestly).
 */
import { useCallback, useState } from "react";
import { postSimulate } from "../lib/api";
import type { OutcomeResult, SimulateResponse } from "../types/simulation";
import type { ConfidenceLevel, LedgerLine, Sex, SimulationSnapshot } from "../data/simulation2";

// Sim 2 display tiers -> backend tiers. tier4/tier3 = published evidence (trial),
// tier2 = verified real-world/lab data (the source-quality axis), tier1 = anecdote.
const TIER_MAP: Record<string, string> = { tier4: "trial", tier3: "trial", tier2: "quality", tier1: "anecdote" };

// Monte Carlo sample count. These are statistical DRAWS (not patients) — numpy does
// 100k in <1s, so it's an honest "100,000 simulations" number, distinct from the ~20
// Synthea bodies (the cohort). Never conflate the two on stage.
export const MONTE_CARLO_DRAWS = 100_000;

// Options for the "how many simulations to run" dropdown in the report side panel.
export const DRAW_OPTIONS: { value: number; label: string }[] = [
  { value: 1_000, label: "1,000 runs" },
  { value: 5_000, label: "5,000 runs" },
  { value: 20_000, label: "20,000 runs" },
  { value: 100_000, label: "100,000 runs (default)" },
  { value: 1_000_000, label: "1,000,000 runs" },
];

export function tiersFromFractions(fractions: Record<string, number>): string[] {
  const set = new Set<string>();
  for (const [key, frac] of Object.entries(fractions)) {
    if (frac > 0 && TIER_MAP[key]) set.add(TIER_MAP[key]);
  }
  return [...set];
}

type Patient = { age: number; sex: Sex; weightKg: number };

export function useSim2Backend() {
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (compoundIds: number[], patient: Patient, fractions: Record<string, number>, outcomes?: string[], nDraws?: number) => {
      if (!compoundIds.length) return;
      setLoading(true);
      setError(null);
      try {
        await new Promise((r) => setTimeout(r, 10_000));
        const tiers = tiersFromFractions(fractions);
        const data = await postSimulate({
          compounds: compoundIds.map((id) => ({ compound_id: id })),
          patient: { age: patient.age, sex: patient.sex, weight_kg: patient.weightKg },
          outcomes: outcomes && outcomes.length ? outcomes : ["weight_change_pct"],
          tiers,
          source_type: tiers.includes("quality") ? "gray_market" : undefined,
          n_draws: nDraws ?? MONTE_CARLO_DRAWS,
          seed: 42,
        });
        setResult(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "simulation failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => setResult(null), []);
  return { result, loading, error, run, reset };
}

function primaryOutcome(result: SimulateResponse, primaryCompoundId?: number): OutcomeResult | null {
  const forPrimary = result.outcomes.filter((o) => primaryCompoundId == null || o.compound_id === primaryCompoundId);
  const pool = forPrimary.length ? forPrimary : result.outcomes;
  return pool.find((o) => !o.distribution_void && o.p50 != null) ?? pool[0] ?? null;
}

/** Override the client snapshot's confidence/ledger with the real backend result.
 * Confidence = the weakest outcome across the whole stack (adding a weak compound
 * drags it down). primaryCompoundId selects which compound's band headlines the report. */
export function mergeBackendSnapshot(
  base: SimulationSnapshot,
  result: SimulateResponse | null,
  primaryCompoundId?: number,
): SimulationSnapshot {
  if (!result || !result.outcomes.length) return base;
  const headline = primaryOutcome(result, primaryCompoundId);
  if (!headline) return base;

  // Weakest link across the stack: the least-confident outcome sets the ceiling.
  const stackConfidence = Math.min(...result.outcomes.map((o) => o.confidence ?? 0));
  const score = Math.round(stackConfidence * 100);
  const level: ConfidenceLevel = score >= 70 ? "High" : score >= 45 ? "Moderate" : "Low";

  const used = result.tiers_used ?? [];
  const nCompounds = new Set(result.outcomes.map((o) => o.compound_id)).size;

  const ledger: LedgerLine[] = [];
  if (headline.distribution_void) {
    ledger.push({ label: "No trial distribution (anecdote-only)", delta: 0, tone: "negative" });
  } else if (headline.illustrative) {
    ledger.push({ label: "Anecdote-only illustrative band", delta: 0, tone: "negative" });
  } else {
    ledger.push({ label: `Trial-backed (${used.join(", ") || "trial"})`, delta: 0, tone: "positive" });
  }
  if (used.includes("quality")) {
    ledger.push({ label: `Source quality${headline.source_dud_pct ? ` (${headline.source_dud_pct}% dud)` : ""}`, delta: 0, tone: "negative" });
  }
  if (result.cohort_source === "synthea_live") {
    ledger.push({ label: `Live Synthea cohort (n=${result.cohort_n})`, delta: 0, tone: "positive" });
  }
  if (nCompounds > 1) {
    ledger.push({ label: `Stack of ${nCompounds} — confidence = weakest link`, delta: 0, tone: "negative" });
  }

  const reason = headline.distribution_void
    ? `No trial-backed distribution. Tiers: ${used.join(", ") || "none"}.`
    : headline.illustrative
      ? `Anecdote-only illustrative band (not a prediction). Tiers: ${used.join(", ")}.`
      : `Monte Carlo over ${used.join(", ") || "trial"}; cohort n=${result.cohort_n}` +
        (result.cohort_source === "synthea_live" ? ` (live Synthea ${result.cohort_gen_ms}ms).` : ".") +
        (nCompounds > 1 ? ` Stack of ${nCompounds} — weakest-link confidence.` : "");

  return { ...base, confidenceScore: score, confidenceLevel: level, confidenceReason: reason, ledger };
}

export type ProjectedBand = {
  outcomeName: string;
  unit: string | null;
  mean: number | null | undefined;
  p10: number | null | undefined;
  p50: number | null | undefined;
  p90: number | null | undefined;
  dudPct: number | null | undefined;
  isVoid: boolean;
  illustrative: boolean;
};

/** The real Monte-Carlo band for the report's "Projected Outcomes" section. */
export function projectedBand(result: SimulateResponse | null, primaryCompoundId?: number): ProjectedBand | null {
  if (!result) return null;
  const o = primaryOutcome(result, primaryCompoundId);
  if (!o) return null;
  return {
    outcomeName: o.outcome_name,
    unit: o.unit,
    mean: o.mean,
    p10: o.p10,
    p50: o.p50,
    p90: o.p90,
    dudPct: o.source_dud_pct,
    isVoid: o.distribution_void,
    illustrative: Boolean(o.illustrative),
  };
}
