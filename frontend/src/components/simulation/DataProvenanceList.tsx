import { Icon } from "@iconify/react";
import { MOCK_PROVENANCE } from "../../data/mockSimulation";
import { useProvenance } from "../../hooks/useProvenance";
import { getProvenanceBadge } from "../../lib/badges";
import type { ProvenanceSource } from "../../types/simulation";
import { cn } from "../../lib/cn";

type ProvenanceRowProps = {
  source: ProvenanceSource;
  showDivider: boolean;
};

function ProvenanceRow({ source, showDivider }: ProvenanceRowProps) {
  const badge = source.tier ? getProvenanceBadge(source.tier) : null;

  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        showDivider ? "border-b border-zinc-800/50 pb-2" : "pt-1",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon icon={source.icon} className="text-zinc-500" />
        <span className="text-zinc-300">{source.label}</span>
      </div>

      <div className="flex items-center gap-2">
        {badge && <span className={badge.className}>{badge.label}</span>}
        <span className="text-xs font-mono text-zinc-500">{source.meta}</span>
      </div>
    </div>
  );
}

export function DataProvenanceList() {
  // Real tier-1 trials + Reddit anecdotes from Supabase; mock only while loading.
  const { sources } = useProvenance();
  const list = sources ?? MOCK_PROVENANCE;

  return (
    <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest mb-3">
        Model Sources
      </h3>

      <div className="space-y-2">
        {list.map((source, index) => (
          <ProvenanceRow key={source.id} source={source} showDivider={index === 0} />
        ))}
      </div>
    </div>
  );
}
