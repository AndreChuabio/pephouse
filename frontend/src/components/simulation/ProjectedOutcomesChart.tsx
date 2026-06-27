import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";
import type { OutcomeResult } from "../../types/simulation";
import { Panel } from "../ui/Panel";

const X_LABELS = ["Base", "Q1", "Q2", "Q3", "Q4"] as const;

type ProjectedOutcomesChartProps = {
  outcome: OutcomeResult | null;
  loading?: boolean;
  error?: string | null;
  cohortCallout?: string | null;
  distributionVoid?: boolean;
  excludedReason?: string | null;
};

function scaleWeight(pct: number): number {
  const clamped = Math.max(-30, Math.min(0, pct));
  return ((clamped + 30) / 30) * 100;
}

function QuarterBars({ outcome }: { outcome: OutcomeResult }) {
  const points = [{ q: 0, p50: 0 }, ...outcome.quarters.map((q) => ({ q: q.q, p50: q.p50 }))];

  return (
    <div className="w-full flex justify-between items-end h-full z-10 px-4 gap-2">
      {points.map((pt, i) => {
        const h = scaleWeight(pt.p50);
        const quarter = outcome.quarters[i - 1];
        return (
          <div key={pt.q} className="flex-1 flex flex-col items-center justify-end h-full group">
            <span className="text-[10px] font-mono text-zinc-500 mb-1 opacity-0 group-hover:opacity-100">
              {quarter ? `${quarter.p10.toFixed(1)} / ${quarter.p50.toFixed(1)} / ${quarter.p90.toFixed(1)}` : "0"}
            </span>
            <div
              className={cn(
                "w-full max-w-[48px] rounded-t-sm bg-blue-900/50 border-t border-blue-500/50",
                i === points.length - 1 && "ring-1 ring-blue-400/40",
              )}
              style={{ height: `${Math.max(h, 2)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ProjectedOutcomesChart({
  outcome,
  loading,
  error,
  cohortCallout,
  distributionVoid,
  excludedReason,
}: ProjectedOutcomesChartProps) {
  const hasCurve = outcome && !distributionVoid && outcome.quarters.length > 0;

  return (
    <Panel className="p-6 flex flex-col min-h-[400px] relative">
      {loading && (
        <div className="absolute inset-0 bg-zinc-950/60 flex items-center justify-center z-20 rounded-xl">
          <Icon icon="svg-spinners:ring-resize" className="text-2xl text-blue-400" />
        </div>
      )}

      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Synthetic Trial Trajectory</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {loading
              ? "Running simulation…"
              : outcome
                ? `${outcome.outcome_name} · confidence ${outcome.confidence.toFixed(2)}`
                : "Run simulation to see quarters"}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {cohortCallout && (
        <div className="mb-4 text-xs text-orange-300/90 bg-orange-500/10 border border-orange-500/25 rounded-md px-3 py-2">
          {cohortCallout}
        </div>
      )}

      {excludedReason && (
        <div className="flex-1 flex items-center justify-center border border-dashed border-orange-500/40 rounded-lg bg-orange-500/5 p-8 text-center">
          <div>
            <p className="text-orange-400 font-medium">Outside trial eligibility</p>
            <p className="text-sm text-zinc-400 mt-2">{excludedReason}</p>
          </div>
        </div>
      )}

      {!excludedReason && distributionVoid && (
        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-orange-500/40 rounded-lg bg-zinc-900/50 p-6 text-center">
          <p className="text-orange-400 font-medium">No trial-backed distribution</p>
          <p className="text-sm text-zinc-500 mt-2 max-w-md">
            No Tier-1 outcome prior — cannot draw a trial-grade curve. Community reports below are
            anecdotal only.
          </p>
        </div>
      )}

      {!excludedReason && !distributionVoid && !hasCurve && !loading && (
        <div className="flex-1 flex items-center justify-center border border-dashed border-zinc-700 rounded-lg text-zinc-500 text-sm">
          Click Run Simulation
        </div>
      )}

      {!excludedReason && hasCurve && outcome && (
        <>
          <div className="flex-1 w-full relative mt-2 flex items-end border-b border-zinc-800 pb-2 min-h-[240px]">
            <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[10px] text-zinc-600 font-mono -ml-1 pr-2">
              <span>0%</span>
              <span>-15%</span>
              <span>-30%</span>
            </div>
            <QuarterBars outcome={outcome} />
          </div>
          <div className="flex justify-between w-full px-6 mt-3 text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
            {X_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          {outcome.p50 != null && (
            <p className="text-[10px] text-zinc-600 mt-2 font-mono">
              Q4 median {outcome.p50.toFixed(1)}% · p10 {outcome.p10?.toFixed(1)}% · p90{" "}
              {outcome.p90?.toFixed(1)}%
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
