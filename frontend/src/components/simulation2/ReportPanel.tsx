import { Icon } from "@iconify/react";
import {
  barOpacity,
  type AudienceMode,
  type CompoundProfile,
  type SimulationSnapshot,
} from "../../data/simulation2";
import type { InteractionPair } from "../../lib/api";
import type { ProjectedBand } from "../../hooks/useSim2Backend";
import { cn } from "../../lib/cn";

type ReportPanelProps = {
  hasRun: boolean;
  audience: AudienceMode;
  compound: CompoundProfile;
  snapshot: SimulationSnapshot;
  onOpenBreakdown: () => void;
  onRun: () => void;
  open: boolean;
  onToggleOpen: () => void;
  chainReady: boolean;
  interactionPairs: InteractionPair[];
  interactionsRequested: boolean;
  band?: ProjectedBand | null;
  running?: boolean;
  draws?: number;
};

function confidenceColor(level: SimulationSnapshot["confidenceLevel"]) {
  if (level === "High") return "text-emerald-400";
  if (level === "Moderate") return "text-amber-500";
  return "text-red-400";
}

const SEVERITY_RANK: Record<string, number> = { major: 3, moderate: 2, minor: 1, unknown: 0 };

function InteractionsCallout({ pairs }: { pairs: InteractionPair[] }) {
  const documented = pairs.filter((p) => p.source_kind !== "no_data");

  if (documented.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1.5 text-zinc-400">
        <div className="flex items-center gap-1.5 font-medium text-xs text-amber-400">
          <Icon icon="solar:danger-triangle-linear" className="text-sm" />
          No documented interactions for this stack.
        </div>
        <p className="text-[11px] leading-snug">
          Searched <span className="text-zinc-300">~2.85M DrugBank rows</span> (via PubChem)
          — none cite this combination.
        </p>
        <p className="text-[11px] text-zinc-500">
          For research peptides, this usually means absence of public evidence, not absence
          of risk. Curate cautiously.
        </p>
      </div>
    );
  }

  const counts: Record<string, number> = {};
  let worst = "unknown";
  for (const p of documented) {
    counts[p.severity] = (counts[p.severity] ?? 0) + 1;
    if ((SEVERITY_RANK[p.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) worst = p.severity;
  }
  const tone =
    worst === "major"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : worst === "moderate"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-zinc-700/60 bg-zinc-800/40 text-zinc-300";
  const summary = (["major", "moderate", "minor", "unknown"] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 space-y-1.5", tone)}>
      <div className="flex items-center gap-1.5 font-medium text-xs">
        <Icon icon="solar:shield-warning-linear" className="text-sm" />
        Drug interactions detected
      </div>
      <p className="text-[11px] leading-snug">
        {documented.length} documented pair{documented.length === 1 ? "" : "s"} — {summary}
      </p>
      <p className="text-[11px] text-zinc-500">
        See the Drug Interactions card in the chain for full mechanism + source citations.
      </p>
    </div>
  );
}

export function ReportPanel({
  hasRun,
  audience,
  compound,
  snapshot,
  onOpenBreakdown,
  onRun,
  open,
  onToggleOpen,
  chainReady,
  interactionPairs,
  interactionsRequested,
  band,
  running,
  draws,
}: ReportPanelProps) {
  if (!open) {
    return (
      <aside className="w-10 bg-[#121212] border-l border-zinc-800 flex flex-col items-center py-3 shrink-0 z-20">
        <button
          type="button"
          onClick={onToggleOpen}
          className="w-7 h-7 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-100"
          title="Open report"
        >
          <Icon icon="solar:alt-arrow-left-linear" className="text-sm" />
        </button>
        {chainReady && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <Icon icon="solar:chart-2-linear" className="text-zinc-500 text-base" />
            <span
              className={cn(
                "text-[10px] font-mono font-medium",
                confidenceColor(snapshot.confidenceLevel),
              )}
            >
              {snapshot.confidenceScore}%
            </span>
          </div>
        )}
        <div
          className="mt-3 text-[10px] uppercase tracking-widest text-zinc-600"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Projection Report
        </div>
      </aside>
    );
  }

  if (!chainReady) {
    return (
      <div className="w-96 bg-[#121212] border-l border-zinc-800 flex flex-col shrink-0 z-20 min-h-0">
        <div className="p-6 border-b border-zinc-800/50 shrink-0 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-1">Generated Output</h3>
            <h2 className="text-lg font-medium tracking-tight text-zinc-100">Projection Report</h2>
          </div>
          <button
            type="button"
            onClick={onToggleOpen}
            className="w-7 h-7 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-100 shrink-0"
            title="Collapse report"
          >
            <Icon icon="solar:alt-arrow-right-linear" className="text-sm" />
          </button>
        </div>
        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-3">
          <Icon icon="solar:test-tube-linear" className="text-zinc-700 text-3xl" />
          <p className="text-xs text-zinc-500 max-w-[240px] leading-relaxed">
            Pick a compound and at least one evidence source in the chain to generate a projection.
          </p>
        </div>
      </div>
    );
  }
  const opacity = barOpacity(snapshot.confidenceScore);
  const topBenefits = compound.benefits.slice(0, audience === "individual" ? 2 : 3);
  const topRisks = compound.sideEffects.slice(0, audience === "individual" ? 3 : 2);

  return (
    <div className="w-96 bg-[#121212] border-l border-zinc-800 flex flex-col shrink-0 z-20 min-h-0">
      <div className="p-6 border-b border-zinc-800/50 shrink-0 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-widest font-medium mb-1">Generated Output</h3>
          <h2 className="text-lg font-medium tracking-tight text-zinc-100">Projection Report</h2>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          className="w-7 h-7 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-100 shrink-0"
          title="Collapse report"
        >
          <Icon icon="solar:alt-arrow-right-linear" className="text-sm" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 min-h-0">
        {interactionsRequested && <InteractionsCallout pairs={interactionPairs} />}
        {!hasRun ? (
          <div className="space-y-4">
            <div className="text-xs text-zinc-500 border border-dashed border-zinc-700 rounded-lg p-4 text-center leading-relaxed">
              Click <span className="text-zinc-300">Run Execution</span> to project benefits and
              risks. Confidence below updates live as you configure the builder.
            </div>

            <div className="space-y-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-200">Evidence Confidence (live)</span>
                <span className={cn("text-sm font-medium", confidenceColor(snapshot.confidenceLevel))}>
                  {snapshot.confidenceScore}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${snapshot.confidenceScore}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500">{snapshot.confidenceReason}</p>
            </div>
          </div>
        ) : (
          <>
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-xs",
                snapshot.confidenceLevel === "High"
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : snapshot.confidenceLevel === "Moderate"
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-200"
                    : "bg-red-500/10 border-red-500/20 text-red-200",
              )}
            >
              <span className="font-medium">Confidence: {snapshot.confidenceLevel}</span>
              <span className="text-zinc-400"> — </span>
              {snapshot.confidenceReason}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-zinc-200">Evidence Confidence</span>
                <span className={cn("text-sm font-medium", confidenceColor(snapshot.confidenceLevel))}>
                  {snapshot.confidenceScore}%
                </span>
              </div>

              <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.min(snapshot.confidenceScore, 70)}%` }}
                />
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{
                    width: `${Math.max(0, Math.min(snapshot.confidenceScore - 70, 25))}%`,
                  }}
                />
                <div
                  className="h-full bg-red-500 transition-all duration-300"
                  style={{
                    width: `${Math.max(0, snapshot.confidenceScore < 45 ? (45 - snapshot.confidenceScore) / 2 : 0)}%`,
                  }}
                />
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 space-y-2 mt-4">
                <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium pb-1 border-b border-zinc-800">
                  Confidence Ledger
                </h4>
                <ul className="text-xs space-y-1.5">
                  {snapshot.ledger.map((line) => (
                    <li key={line.label} className="flex justify-between items-center text-zinc-300">
                      <span>{line.label}</span>
                      <span
                        className={cn(
                          line.tone === "positive"
                            ? "text-emerald-400"
                            : line.delta < 0
                              ? "text-amber-500"
                              : "text-zinc-400",
                        )}
                      >
                        {line.delta > 0 ? "+" : ""}
                        {line.delta}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {audience === "clinician" && (
              <div className="space-y-2 text-xs border border-zinc-800 rounded-lg p-3 bg-zinc-900/40">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  Regulatory status
                </div>
                <p className="text-zinc-200">{compound.regulatoryStatus}</p>
                <p className="text-zinc-500 leading-relaxed">{compound.approvalPath}</p>
              </div>
            )}

            <div className="w-full h-px bg-zinc-800" />

            <div className="space-y-5">
              <h3 className="text-sm font-medium tracking-tight text-zinc-100 flex items-center gap-2">
                <Icon icon="solar:chart-square-linear" className="text-zinc-500" />
                {audience === "individual" ? "What you might notice" : "Projected Outcomes"}
              </h3>

              {running ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
                  Computing projection…
                </div>
              ) : band ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                  {band.isVoid ? (
                    <p className="text-xs text-orange-400">
                      No trial-backed distribution for {band.outcomeName.replace(/_/g, " ")} — community reports only,
                      not a prediction.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-zinc-400">
                          {band.outcomeName.replace(/_/g, " ")}
                          {band.illustrative ? " (anecdotal · illustrative)" : ""}
                        </span>
                        <span className="font-mono text-base text-emerald-400">
                          {band.p50 != null ? `${band.p50}${band.unit ?? "%"}` : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                        <span>p10 {band.p10 != null ? `${band.p10}${band.unit ?? "%"}` : "—"}</span>
                        <span>mean {band.mean != null ? `${band.mean}${band.unit ?? "%"}` : "—"}</span>
                        <span>p90 {band.p90 != null ? `${band.p90}${band.unit ?? "%"}` : "—"}</span>
                      </div>
                      {band.dudPct ? (
                        <p className="text-[11px] text-orange-400">
                          ~{band.dudPct}% chance of a near-inert (under-dosed) source.
                        </p>
                      ) : null}
                      {draws ? (
                        <p className="text-[10px] text-zinc-600">
                          Projected from {draws.toLocaleString()} Monte Carlo simulations.
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              <div className="space-y-3">
                <h4 className="text-xs font-medium text-zinc-400">
                  {audience === "individual" ? "Risks to watch" : "Surfaced Risks"}
                </h4>
                {topRisks.map((risk) => {
                  const elevated = risk.severity === "elevated";
                  return (
                    <div
                      key={risk.label}
                      className={cn(
                        "p-3 rounded-lg space-y-2 border",
                        elevated
                          ? "border-red-500/20 bg-red-500/5"
                          : "border-zinc-800 bg-zinc-900/50",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Icon
                          icon={elevated ? "solar:shield-warning-linear" : "solar:info-circle-linear"}
                          className={cn(
                            "text-sm mt-0.5 shrink-0",
                            elevated ? "text-red-500" : "text-zinc-500",
                          )}
                        />
                        <div>
                          <span
                            className={cn(
                              "text-xs font-medium block",
                              elevated ? "text-red-400" : "text-zinc-200",
                            )}
                          >
                            {risk.label}
                          </span>
                          {risk.detail && (
                            <p
                              className={cn(
                                "text-[11px] leading-snug mt-0.5",
                                elevated ? "text-red-300/80" : "text-zinc-500",
                              )}
                            >
                              {audience === "individual"
                                ? risk.detail.split(".")[0] + "."
                                : risk.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-medium text-zinc-400">
                  {audience === "individual" ? "Possible benefits" : "Reported Benefits"}
                </h4>
                {topBenefits.map((b) => (
                  <div key={b.label} className="space-y-2">
                    <div className="flex justify-between items-end">
                      <span className="text-xs text-zinc-200">{b.label}</span>
                      {b.probabilityLabel && (
                        <span className="text-[10px] text-zinc-500">{b.probabilityLabel}</span>
                      )}
                    </div>
                    <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500/70 transition-all duration-300"
                        style={{ width: `${b.percent}%`, opacity }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="p-4 border-t border-zinc-800/50 bg-[#121212] shrink-0">
        <button
          type="button"
          onClick={onRun}
          className="w-full py-2 mb-2 bg-zinc-100 border border-transparent rounded-md text-xs font-medium text-zinc-900 hover:bg-white transition-colors shadow-sm flex items-center justify-center gap-2"
        >
          <Icon icon="solar:play-linear" className="text-sm" />
          Run Simulation
        </button>
        <button
          type="button"
          onClick={onOpenBreakdown}
          disabled={!hasRun}
          className="w-full py-2 bg-[#0A0A0A] border border-zinc-700 rounded-md text-xs font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors shadow-sm flex items-center justify-center gap-2"
        >
          <Icon icon="solar:chart-2-linear" className="text-sm" />
          View Full Breakdown
        </button>
      </div>
    </div>
  );
}
