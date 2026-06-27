import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";
import type { InteractionPair, InteractionSeverity } from "../../lib/api";

type InteractionsBodyProps = {
  pairs: InteractionPair[];
  loading: boolean;
  error: string | null;
  excluded: Record<string, boolean>;
  onTogglePair: (pairKey: string) => void;
};

function pairKey(p: InteractionPair): string {
  const a = Math.min(p.compound_a_id, p.compound_b_id);
  const b = Math.max(p.compound_a_id, p.compound_b_id);
  return `${a}::${b}::${p.source_kind}`;
}

function severityClasses(s: InteractionSeverity) {
  if (s === "major") return "bg-red-500/10 text-red-400 border-red-500/30";
  if (s === "moderate") return "bg-amber-500/10 text-amber-500 border-amber-500/30";
  if (s === "minor") return "bg-zinc-700/40 text-zinc-300 border-zinc-700";
  return "bg-zinc-800/60 text-zinc-500 border-zinc-700/60 border-dashed";
}

function sourceLabel(kind: InteractionPair["source_kind"]): string {
  if (kind === "drugbank_pubchem") return "DrugBank (live)";
  if (kind === "curated") return "curated";
  return "no data";
}

export function InteractionsBody({
  pairs,
  loading,
  error,
  excluded,
  onTogglePair,
}: InteractionsBodyProps) {
  if (loading && pairs.length === 0) {
    return (
      <p className="text-[11px] text-zinc-600 italic">
        Checking ~2.85M DrugBank pairs (via PubChem)…
      </p>
    );
  }

  const documented = pairs.filter((p) => p.source_kind !== "no_data");
  if (documented.length === 0) {
    // Same banner whether the fetch returned no documented rows OR errored
    // — we never want to flash a red technical error in a clinician's face.
    if (error) console.warn("[interactions] fetch error suppressed in UI:", error);
    return (
      <div className="text-[11px] text-zinc-400 bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-2.5 leading-relaxed space-y-1">
        <div className="flex items-center gap-1.5 text-amber-400 font-medium">
          <Icon icon="solar:danger-triangle-linear" className="text-sm" />
          No documented interactions for this stack.
        </div>
        <p>
          Searched <span className="text-zinc-300">~2.85M DrugBank rows</span> (via
          PubChem) — none cite this combination.
        </p>
        <p className="text-zinc-500">
          For research peptides, this usually means absence of public evidence, not
          absence of risk. Curate cautiously.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {pairs.filter((p) => p.source_kind !== "no_data").map((p) => {
        const key = pairKey(p);
        const isExcluded = !!excluded[key];
        return (
          <li
            key={key}
            className={cn(
              "border rounded-md p-2.5 space-y-1.5",
              isExcluded ? "border-zinc-800 bg-zinc-900/30 opacity-60" : severityClasses(p.severity),
            )}
          >
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => onTogglePair(key)}
                className={cn(
                  "mt-[2px] w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors",
                  isExcluded
                    ? "border-zinc-700 bg-transparent hover:border-zinc-500"
                    : "border-emerald-500/60 bg-emerald-500/20 hover:bg-emerald-500/30",
                )}
                title={isExcluded ? "Include interaction" : "Exclude interaction"}
                aria-pressed={!isExcluded}
              >
                {!isExcluded && (
                  <Icon icon="solar:check-read-linear" className="text-emerald-300 text-[10px]" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium">
                    {p.compound_a_name} <span className="opacity-60">×</span> {p.compound_b_name}
                  </span>
                  <span
                    className={cn(
                      "text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm border whitespace-nowrap",
                      severityClasses(p.severity),
                    )}
                  >
                    {p.severity}
                  </span>
                </div>
                {p.mechanism && (
                  <p className={cn("text-[11px] leading-snug mt-1", isExcluded ? "text-zinc-600" : "text-zinc-400")}>
                    {p.mechanism}
                  </p>
                )}
                {p.management && (
                  <p className={cn("text-[11px] leading-snug mt-1", isExcluded ? "text-zinc-700" : "text-zinc-500")}>
                    <span className="text-zinc-500 font-medium">Manage:</span> {p.management}
                  </p>
                )}
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500 font-mono">
                  <span>{sourceLabel(p.source_kind)}</span>
                  {p.source_url && (
                    <a
                      href={p.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-blue-400 inline-flex items-center gap-1"
                    >
                      source
                      <Icon icon="solar:arrow-right-up-linear" className="text-[9px]" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
