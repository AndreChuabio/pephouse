/**
 * Bridges the Simulation 2 node-builder to the real backend POST /simulate,
 * so "Run Execution" produces real Monte-Carlo numbers instead of the client-side
 * estimate. Self-contained so it can be dropped into Simulation2Page without
 * touching the builder's own logic.
 *
 * Wire-in (4 lines in Simulation2Page):
 *   const backend = useSim2Backend();
 *   const reportSnapshot = mergeBackendSnapshot(snapshot, backend.result);
 *   // in handleRun: const bid = compoundBackendIds[0]; if (bid) backend.run(bid, { age, sex, weightKg: weight }, sourceFractions);
 *   // pass snapshot={reportSnapshot} to <ReportPanel> and <BreakdownModal>
 */
import { useCallback } from "react";
import { useSimulation } from "./useSimulation";
import type { SimulateResponse } from "../types/simulation";
import type { ConfidenceLevel, LedgerLine, Sex, SimulationSnapshot } from "../data/simulation2";

// Sim 2 display tiers -> backend tiers. tier4/tier3 are published evidence (trial),
// tier2 is verified real-world/lab data (the source-quality axis), tier1 is anecdote.
const TIER_MAP: Record<string, string> = { tier4: "trial", tier3: "trial", tier2: "quality", tier1: "anecdote" };

export function tiersFromFractions(fractions: Record<string, number>): string[] {
  const set = new Set<string>();
  for (const [key, frac] of Object.entries(fractions)) {
    if (frac > 0 && TIER_MAP[key]) set.add(TIER_MAP[key]);
  }
  return [...set];
}

export function useSim2Backend() {
  const sim = useSimulation();
  const run = useCallback(
    (backendId: number, patient: { age: number; sex: Sex; weightKg: number }, fractions: Record<string, number>) => {
      const tiers = tiersFromFractions(fractions);
      sim.run(backendId, patient, {
        tiers,
        sourceType: tiers.includes("quality") ? "gray_market" : undefined,
        nDraws: 5000,
      });
    },
    [sim],
  );
  return { result: sim.result, loading: sim.loading, error: sim.error, run };
}

/** Override a client snapshot's confidence fields with the real backend result. */
export function mergeBackendSnapshot(base: SimulationSnapshot, result: SimulateResponse | null): SimulationSnapshot {
  if (!result) return base;
  const outcome = result.outcomes.find((o) => o.outcome_name === "weight_change_pct") ?? result.outcomes[0];
  if (!outcome) return base;

  const score = Math.round((outcome.confidence ?? 0) * 100);
  const level: ConfidenceLevel = score >= 70 ? "High" : score >= 45 ? "Moderate" : "Low";
  const used = result.tiers_used ?? [];

  const ledger: LedgerLine[] = [{ label: "Base compound profile", delta: 0, tone: "positive" }];
  if (used.includes("trial")) ledger.push({ label: "Trial evidence (Tier-1 priors)", delta: 30, tone: "positive" });
  if (used.includes("quality")) {
    ledger.push({
      label: `Source quality${outcome.source_dud_pct ? ` (${outcome.source_dud_pct}% dud)` : ""}`,
      delta: -10,
      tone: "negative",
    });
  }
  if (used.includes("anecdote")) {
    ledger.push({
      label: outcome.illustrative ? "Anecdote-only (illustrative)" : "Anecdote layer",
      delta: -25,
      tone: "negative",
    });
  }
  if (used.includes("synthetic")) {
    ledger.push({ label: `Live Synthea cohort (n=${result.cohort_n})`, delta: 0, tone: "positive" });
  }

  const reason = outcome.distribution_void
    ? `No trial-backed distribution. Tiers: ${used.join(", ") || "none"}.`
    : outcome.illustrative
      ? `Anecdote-only illustrative band (not a prediction). Tiers: ${used.join(", ")}.`
      : `Monte Carlo over ${used.join(", ") || "trial"}; cohort n=${result.cohort_n}` +
        (result.cohort_source === "synthea_live" ? ` (live Synthea ${result.cohort_gen_ms}ms).` : ".");

  return { ...base, confidenceScore: score, confidenceLevel: level, confidenceReason: reason, ledger };
}

/** The real projected outcome band, for an optional "Projected (Monte Carlo)" line. */
export function projectedOutcome(result: SimulateResponse | null): {
  mean: number | null | undefined;
  p10: number | null | undefined;
  p90: number | null | undefined;
  unit: string | null;
  void: boolean;
  illustrative: boolean;
} | null {
  if (!result) return null;
  const o = result.outcomes.find((x) => x.outcome_name === "weight_change_pct") ?? result.outcomes[0];
  if (!o) return null;
  return { mean: o.mean, p10: o.p10, p90: o.p90, unit: o.unit, void: o.distribution_void, illustrative: Boolean(o.illustrative) };
}
