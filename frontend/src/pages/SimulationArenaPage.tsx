import { useEffect, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { ArenaHeader } from "../components/layout/ArenaHeader";
import { CocktailMixerCard } from "../components/simulation/CocktailMixerCard";
import { DataProvenanceList } from "../components/simulation/DataProvenanceList";
import { DemographicsCard } from "../components/simulation/DemographicsCard";
import { MetricsGrid } from "../components/simulation/MetricsGrid";
import { ProjectedOutcomesChart } from "../components/simulation/ProjectedOutcomesChart";
import { useCompounds } from "../hooks/useCompounds";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useSimulation } from "../hooks/useSimulation";
import type { PatientInput } from "../types/simulation";

const DEFAULT_COMPOUND_ID = 3; // Tirzepatide

export default function SimulationArenaPage() {
  useDocumentTitle("PepHouse | Simulation Arena");

  const { compounds } = useCompounds();
  const { result, loading, error, run } = useSimulation();

  const [patient, setPatient] = useState<PatientInput>({ age: 55, sex: "M", weightKg: 102 });
  const [selectedCompoundId, setSelectedCompoundId] = useState<number | null>(DEFAULT_COMPOUND_ID);

  useEffect(() => {
    if (compounds?.length && selectedCompoundId == null) {
      const tirz = compounds.find((c) => c.name === "Tirzepatide");
      setSelectedCompoundId(tirz ? Number(tirz.id) : Number(compounds[0].id));
    }
  }, [compounds, selectedCompoundId]);

  const handleRun = () => {
    if (selectedCompoundId == null) return;
    run(selectedCompoundId, patient);
  };

  return (
    <AppShell>
      <ArenaHeader
        onRun={handleRun}
        loading={loading}
        cohortN={result?.cohort_n ?? null}
      />

      <div className="flex-1 overflow-y-auto p-8 z-10">
        {error && (
          <div className="max-w-7xl mx-auto mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-4 py-3">
            {error}
            <span className="block text-xs text-zinc-500 mt-1">
              Is the backend running? <code className="text-zinc-400">uvicorn main:app --reload</code>
            </span>
          </div>
        )}

        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
          <section className="xl:col-span-4 space-y-6" aria-label="Simulation inputs">
            <DemographicsCard patient={patient} onChange={setPatient} />
            <CocktailMixerCard
              selectedId={selectedCompoundId}
              onSelect={setSelectedCompoundId}
            />
          </section>

          <section className="xl:col-span-8 space-y-6" aria-label="Simulation outputs">
            <ProjectedOutcomesChart result={result} loading={loading} />
            <MetricsGrid result={result} />
            <DataProvenanceList />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
