import { Icon } from "@iconify/react";
import { MOCK_PROVENANCE } from "../../data/mockSimulation";
import { useProvenance } from "../../hooks/useProvenance";
import { getProvenanceBadge } from "../../lib/badges";
import { cn } from "../../lib/cn";
import type { ProvenanceSource } from "../../types/simulation";

type Anecdote = {
  permalink?: string | null;
  claimed_effect?: string | null;
  sentiment?: string | null;
};

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

type DataProvenanceListProps = {
  anecdotes?: Anecdote[];
  showAnecdotes?: boolean;
};

export function DataProvenanceList({ anecdotes = [], showAnecdotes }: DataProvenanceListProps) {
  const { sources } = useProvenance();
  const list = sources ?? MOCK_PROVENANCE;

  return (
    <div className="bg-zinc-900/20 border border-zinc-800/50 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest mb-3">Model Sources</h3>

      <div className="space-y-2">
        {list.map((source, index) => (
          <ProvenanceRow key={source.id} source={source} showDivider={index === 0} />
        ))}
      </div>

      {showAnecdotes && anecdotes.length > 0 && (
        <div className="mt-4 pt-4 border-t border-zinc-800/60">
          <p className="text-[10px] uppercase tracking-wider text-amber-500/80 font-semibold mb-2">
            Tier-3 anecdotes (context only)
          </p>
          <ul className="space-y-2">
            {anecdotes.map((a, i) => (
              <li
                key={a.permalink ?? i}
                className="text-xs text-zinc-400 border border-zinc-800/80 rounded-lg p-3 bg-zinc-950/40"
              >
                {a.claimed_effect && <p className="text-zinc-300 mb-1">{a.claimed_effect}</p>}
                {a.sentiment && (
                  <span className="text-[10px] uppercase tracking-wider text-amber-500/80">{a.sentiment}</span>
                )}
                {a.permalink && (
                  <a
                    href={a.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="block mt-2 text-blue-400/80 hover:text-blue-300 truncate"
                  >
                    {a.permalink}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
