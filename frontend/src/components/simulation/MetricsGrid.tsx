import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";
import type { SimulateResponse } from "../../types/simulation";
import { Panel } from "../ui/Panel";

function confidenceLevel(c: number): 1 | 2 | 3 {
  if (c >= 0.65) return 3;
  if (c >= 0.5) return 2;
  return 1;
}

type MetricsGridProps = {
  result: SimulateResponse | null;
};

export function MetricsGrid({ result }: MetricsGridProps) {
  const outcome = result?.outcomes[0];
  const prob =
    outcome?.prob_threshold != null ? `${Math.round(outcome.prob_threshold * 100)}%` : "—";
  const conf = outcome?.confidence ?? null;
  const confLabel = result?.data_confidence ?? "—";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Panel className="p-4">
        <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5">
          <Icon icon="solar:graph-up-linear" />
          Weight reduction prob.
        </div>
        <div className="text-2xl font-medium text-white">{prob}</div>
        <div className="text-xs text-zinc-400">for &gt;15% loss</div>
        {outcome?.prob_threshold != null && (
          <div className="mt-3 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/80"
              style={{ width: `${outcome.prob_threshold * 100}%` }}
            />
          </div>
        )}
      </Panel>

      <Panel className="p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-orange-500/5 pointer-events-none" />
        <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5 relative">
          <Icon icon="solar:users-group-rounded-linear" />
          Cohort match
        </div>
        <div className="text-2xl font-medium text-orange-400 relative">
          {result ? result.cohort_n : "—"}
        </div>
        <div className="text-xs text-zinc-400 relative">synthetic_patients</div>
        {result?.substrate_missing && (
          <p className="text-[10px] text-zinc-500 mt-2 relative">Tier-4 thin → anecdote fallback</p>
        )}
      </Panel>

      <Panel className="p-4">
        <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5">
          <Icon icon="solar:shield-check-linear" />
          Data confidence
        </div>
        <div className="text-2xl font-medium text-white">{conf != null ? conf.toFixed(2) : "—"}</div>
        <div className="text-xs text-zinc-400">{confLabel}</div>
        {conf != null && (
          <div className="mt-2 flex gap-1">
            {([1, 2, 3] as const).map((step) => (
              <div
                key={step}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  step <= confidenceLevel(conf) ? "bg-blue-500" : "bg-zinc-800",
                )}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
