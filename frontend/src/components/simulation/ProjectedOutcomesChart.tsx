import { cn } from "../../lib/cn";
import type { OutcomeResult, SimulateResponse } from "../../types/simulation";
import { Panel } from "../ui/Panel";

const X_LABELS = ["Base", "Q1", "Q2", "Q3", "Q4"] as const;

function scaleWeight(pct: number): number {
  const clamped = Math.max(-30, Math.min(0, pct));
  return ((clamped + 30) / 30) * 100;
}

type ProjectedOutcomesChartProps = {
  result: SimulateResponse | null;
  loading: boolean;
};

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
              {quarter ? `${quarter.p10} / ${quarter.p50} / ${quarter.p90}` : "0"}
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

export function ProjectedOutcomesChart({ result, loading }: ProjectedOutcomesChartProps) {
  const outcome = result?.outcomes[0];
  const excluded = result?.excluded_priors[0];
  const isVoid = outcome?.distribution_void;
  const hasCurve = outcome && !isVoid && outcome.quarters.length > 0;

  return (
    <Panel className="p-6 flex flex-col min-h-[400px]">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Synthetic Trial Trajectory</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {loading
              ? "Running simulation…"
              : outcome
                ? `${outcome.outcome_name} · confidence ${outcome.confidence}`
                : "Run simulation to see quarters"}
          </p>
        </div>
      </div>

      {result?.cohort_callout && (
        <div className="mb-4 text-xs text-orange-300/90 bg-orange-500/10 border border-orange-500/25 rounded-md px-3 py-2">
          {result.cohort_callout}
        </div>
      )}

      {excluded && (
        <div className="flex-1 flex items-center justify-center border border-dashed border-orange-500/40 rounded-lg bg-orange-500/5 p-8 text-center">
          <div>
            <p className="text-orange-400 font-medium">Not eligible for this trial</p>
            <p className="text-sm text-zinc-400 mt-2">{excluded.reason}</p>
          </div>
        </div>
      )}

      {!excluded && isVoid && (
        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-orange-500/40 rounded-lg bg-zinc-900/50 p-6 text-center">
          <p className="text-orange-400 font-medium">distribution_void</p>
          <p className="text-sm text-zinc-500 mt-2 max-w-md">
            No Tier-1 outcome_prior — cannot draw a trial-grade curve.
          </p>
          {result?.anecdotes && result.anecdotes.length > 0 && (
            <div className="mt-4 w-full max-w-lg space-y-2 text-left">
              {result.anecdotes.slice(0, 3).map((a, i) => (
                <div key={i} className="text-xs text-zinc-400 bg-zinc-950 border border-zinc-800 rounded p-2">
                  {a.claimed_effect}
                  {a.permalink && (
                    <a href={a.permalink} target="_blank" rel="noreferrer" className="block text-blue-400 mt-1 truncate">
                      {a.permalink}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!excluded && !isVoid && !hasCurve && !loading && (
        <div className="flex-1 flex items-center justify-center border border-dashed border-zinc-700 rounded-lg text-zinc-500 text-sm">
          Click Run Simulation
        </div>
      )}

      {!excluded && hasCurve && outcome && (
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
          <p className="text-[10px] text-zinc-600 mt-2 font-mono">
            Q4 median {outcome.p50}% · p10 {outcome.p10}% · p90 {outcome.p90}%
          </p>
        </>
      )}
    </Panel>
  );
}
