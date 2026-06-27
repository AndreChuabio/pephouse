import { AppShell } from "../components/layout/AppShell";
import { ArenaHeader } from "../components/layout/ArenaHeader";
import { CocktailMixerCard } from "../components/simulation/CocktailMixerCard";
import { DataProvenanceList } from "../components/simulation/DataProvenanceList";
import { DemographicsCard } from "../components/simulation/DemographicsCard";
import { MetricsGrid } from "../components/simulation/MetricsGrid";
import { ProjectedOutcomesChart } from "../components/simulation/ProjectedOutcomesChart";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function SimulationArenaPage() {
  useDocumentTitle("PepHouse | Simulation Arena");

  return (
    <AppShell>
      <ArenaHeader />

      <div className="flex-1 overflow-y-auto p-8 z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6">
          <section className="xl:col-span-4 space-y-6" aria-label="Simulation inputs">
            <DemographicsCard />
            <CocktailMixerCard />
          </section>

          <section className="xl:col-span-8 space-y-6" aria-label="Simulation outputs">
            <ProjectedOutcomesChart />
            <MetricsGrid />
            <DataProvenanceList />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
