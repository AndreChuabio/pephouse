import { Icon } from "@iconify/react";
import { MOCK_METRICS } from "../../data/mockSimulation";
import { cn } from "../../lib/cn";
import type { MetricCard } from "../../types/simulation";
import { Panel } from "../ui/Panel";

function ConfidenceMeter({ level }: { level: 1 | 2 | 3 }) {
  return (
    <div className="mt-2 flex gap-1">
      {([1, 2, 3] as const).map((step) => (
        <div
          key={step}
          className={cn("h-1 flex-1 rounded-full", step <= level ? "bg-blue-500" : "bg-zinc-800")}
        />
      ))}
    </div>
  );
}

type MetricCardViewProps = {
  metric: MetricCard;
};

function MetricCardView({ metric }: MetricCardViewProps) {
  const isWarning = metric.tone === "warning";
  const foreground = isWarning ? "relative z-10" : undefined;

  return (
    <Panel className="p-4 flex flex-col justify-between relative overflow-hidden">
      {isWarning && <div className="absolute inset-0 bg-orange-500/5 pointer-events-none" />}

      <div className={cn("text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5", foreground)}>
        <Icon icon={metric.icon} />
        {metric.label}
      </div>

      <div className={cn("flex items-baseline gap-2", foreground)}>
        <span className={cn("text-2xl font-medium tracking-tight", isWarning ? "text-orange-400" : "text-white")}>
          {metric.value}
        </span>
        {metric.detail && <span className="text-xs text-zinc-400">{metric.detail}</span>}
      </div>

      {metric.progressPercent !== undefined && (
        <div className="mt-3 w-full h-0.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500/80" style={{ width: `${metric.progressPercent}%` }} />
        </div>
      )}

      {metric.tone === "confidence" && metric.confidenceLevel !== undefined && (
        <ConfidenceMeter level={metric.confidenceLevel} />
      )}

      {metric.note && (
        <p className={cn("text-[10px] text-zinc-500 mt-2 leading-tight", foreground)}>
          {metric.note}
        </p>
      )}
    </Panel>
  );
}

export function MetricsGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {MOCK_METRICS.map((metric) => (
        <MetricCardView key={metric.id} metric={metric} />
      ))}
    </div>
  );
}
