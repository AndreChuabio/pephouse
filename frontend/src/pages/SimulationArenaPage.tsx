import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { ArenaHeader } from "../components/layout/ArenaHeader";
import { CocktailMixerCard } from "../components/simulation/CocktailMixerCard";
import { DataProvenanceList } from "../components/simulation/DataProvenanceList";
import { DemographicsCard } from "../components/simulation/DemographicsCard";
import { MetricsGrid } from "../components/simulation/MetricsGrid";
import { ProjectedOutcomesChart } from "../components/simulation/ProjectedOutcomesChart";
import { COMPOUNDS, DEMOGRAPHICS } from "../data/mockSimulation";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useSimulation } from "../hooks/useSimulation";
import type { MetricCard, OutcomeResult, SimulateResponse } from "../types/simulation";

function buildMetrics(result: SimulateResponse | null, weightOutcome: OutcomeResult | null): MetricCard[] {
  if (!result || !weightOutcome) {
    return [
      {
        id: "cohort",
        icon: "solar:users-group-rounded-linear",
        label: "Cohort match",
        value: "—",
        note: "Run simulation to match Tier-4 patients",
      },
      {
        id: "confidence",
        icon: "solar:shield-check-linear",
        label: "Data Confidence",
        value: "—",
      },
      {
        id: "prob",
        icon: "solar:chart-square-linear",
        label: "P(≥15% loss)",
        value: "—",
      },
    ];
  }

  const cohortLabel =
    result.cohort_n === 0
      ? "No match"
      : `${result.cohort_n} patient${result.cohort_n === 1 ? "" : "s"}`;

  const confidencePct = Math.round((weightOutcome.confidence ?? 0) * 100);

  return [
    {
      id: "cohort",
      icon: "solar:users-group-rounded-linear",
      label: "Cohort match",
      value: cohortLabel,
      detail: result.substrate_missing ? "Thin match — widened uncertainty" : undefined,
      tone: result.substrate_missing ? "warning" : "default",
      note: result.cohort_fallback === "anecdote" ? "Fallback: Tier-3 anecdotes" : undefined,
    },
    {
      id: "confidence",
      icon: "solar:shield-check-linear",
      label: "Data Confidence",
      value: result.data_confidence,
      progressPercent: confidencePct,
      confidenceLevel: confidencePct >= 70 ? 3 : confidencePct >= 40 ? 2 : 1,
      tone: "confidence",
    },
    {
      id: "prob",
      icon: "solar:chart-square-linear",
      label: "P(≥15% loss)",
      value:
        weightOutcome.prob_threshold != null
          ? `${Math.round(weightOutcome.prob_threshold * 100)}%`
          : "—",
      detail:
        weightOutcome.mean != null && weightOutcome.sd != null
          ? `μ ${weightOutcome.mean.toFixed(1)}%, σ ${weightOutcome.sd.toFixed(1)}`
          : undefined,
    },
  ];
}

const TIER_OPTIONS: { key: string; label: string }[] = [
  { key: "trial", label: "Trial" },
  { key: "quality", label: "Quality (source)" },
  { key: "anecdote", label: "Anecdote" },
  { key: "synthetic", label: "Synthetic (live)" },
];

export default function SimulationArenaPage() {
  useDocumentTitle("PepHouse | Simulation [old]");

  const [patient, setPatient] = useState(DEMOGRAPHICS);
  const [selectedCompoundId, setSelectedCompoundId] = useState(COMPOUNDS[1].id);
  const [sourceType, setSourceType] = useState("");
  const [tiers, setTiers] = useState<string[]>(["trial"]);
  const toggleTier = (k: string) => setTiers((ts) => (ts.includes(k) ? ts.filter((x) => x !== k) : [...ts, k]));
  const [nDraws, setNDraws] = useState(5000);
  const { result, loading, error, run } = useSimulation();

  const weightOutcome = result?.outcomes.find((o) => o.outcome_name === "weight_change_pct") ?? null;

  const excludedReason = useMemo(() => {
    const ex = result?.excluded_priors?.[0];
    if (!ex) return null;
    if (ex.reason.toLowerCase().includes("age")) {
      return "Patient age is outside the range covered by trial priors.";
    }
    return ex.reason.replace(/_/g, " ");
  }, [result]);

  const metrics = useMemo(() => buildMetrics(result, weightOutcome), [result, weightOutcome]);

  // Live Synthea generation takes ~15-20s; show an elapsed-time loader so the wait reads as intentional.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(id);
  }, [loading]);

  const isLive = tiers.includes("synthetic");
  const loadingLabel = isLive
    ? `Generating patient-matched Synthea cohort live… ${elapsed.toFixed(0)}s (~15-20s)`
    : "Running Monte Carlo…";
  const loadingProgress = isLive ? Math.min(95, (elapsed / 20) * 100) : null;

  const handleRun = () => {
    run(Number(selectedCompoundId), patient, {
      sourceType: tiers.includes("quality") ? sourceType || "gray_market" : undefined,
      liveCohort: tiers.includes("synthetic"),
      nDraws,
      tiers,
    });
  };

  return (
    <AppShell>
      <ArenaHeader onRun={handleRun} running={loading} />

      <div className="flex-1 overflow-y-auto p-8 z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
          <section className="xl:col-span-4 space-y-6" aria-label="Simulation inputs">
            <DemographicsCard patient={patient} onChange={setPatient} />
            <CocktailMixerCard selectedId={selectedCompoundId} onSelect={setSelectedCompoundId} />

            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <Icon icon="solar:tuning-2-linear" /> Simulation controls
              </h3>

              <div>
                <label className="text-xs text-zinc-500">Data tiers (what feeds the twin)</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TIER_OPTIONS.map((t) => {
                    const on = tiers.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleTier(t.key)}
                        aria-pressed={on}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${on ? "bg-blue-500/20 border-blue-500/50 text-blue-200" : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">Anecdote widens the band + lowers confidence. Synthetic = live Synthea cohort (~7s).</p>
              </div>

              <div>
                <label className="text-xs text-zinc-500">Source (where you bought it)</label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
                >
                  <option value="">Label dose (no source modeling)</option>
                  <option value="compounding_pharmacy">Compounding pharmacy (clean)</option>
                  <option value="vendor_tested">Gray-market, lab-tested</option>
                  <option value="gray_market">Gray-market, untested (China)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-zinc-500">Run synthetic patient scenarios</label>
                <select
                  value={nDraws}
                  onChange={(e) => setNDraws(Number(e.target.value))}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
                >
                  <option value={1000}>1,000 runs (fast)</option>
                  <option value={5000}>5,000 runs (default)</option>
                  <option value={20000}>20,000 runs (smooth tails)</option>
                </select>
              </div>
            </div>
          </section>

          <section className="xl:col-span-8 space-y-6" aria-label="Simulation outputs">
            <ProjectedOutcomesChart
              outcome={weightOutcome}
              loading={loading}
              loadingLabel={loadingLabel}
              loadingProgress={loadingProgress}
              error={error}
              cohortCallout={result?.cohort_callout}
              distributionVoid={weightOutcome?.distribution_void}
              excludedReason={excludedReason}
            />
            {result && (
              <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-lg p-3 text-xs flex flex-wrap items-center gap-2">
                <span className="text-zinc-500">Tiers used:</span>
                {(result.tiers_used ?? []).length ? (
                  (result.tiers_used ?? []).map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">{t}</span>
                  ))
                ) : (
                  <span className="text-zinc-600">none available</span>
                )}
                {weightOutcome?.illustrative && (
                  <span className="text-amber-400">illustrative band (anecdote-only, not a prediction)</span>
                )}
                {(result.tier_notes ?? []).map((n, i) => (
                  <span key={i} className="text-orange-400/80">{n}</span>
                ))}
              </div>
            )}
            <MetricsGrid metrics={metrics} />
            <DataProvenanceList
              anecdotes={result?.anecdotes}
              showAnecdotes={
                Boolean(weightOutcome?.distribution_void) || result?.cohort_fallback === "anecdote"
              }
            />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
