import { useMemo, useState } from "react";
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
import type {
  MetricCard,
  OutcomeResult,
  PatientInput,
  SimulateResponse,
} from "../types/simulation";

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

export default function SimulationArenaPage() {
  useDocumentTitle("PepHouse | Simulation Arena");

  const [patient, setPatient] = useState<PatientInput>(DEMOGRAPHICS);
  const [selectedCompoundId, setSelectedCompoundId] = useState(COMPOUNDS[1].id);
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

  const handleRun = () => {
    run(Number(selectedCompoundId), patient);
  };

  return (
    <AppShell>
      <ArenaHeader onRun={handleRun} running={loading} />

      <div className="flex-1 overflow-y-auto p-8 z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
          <section className="xl:col-span-4 space-y-6" aria-label="Simulation inputs">
            <DemographicsCard patient={patient} onChange={setPatient} />
            <CocktailMixerCard selectedId={selectedCompoundId} onSelect={setSelectedCompoundId} />
          </section>

          <section className="xl:col-span-8 space-y-6" aria-label="Simulation outputs">
            <ProjectedOutcomesChart
              outcome={weightOutcome}
              loading={loading}
              error={error}
              cohortCallout={result?.cohort_callout}
              distributionVoid={weightOutcome?.distribution_void}
              excludedReason={excludedReason}
            />
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
