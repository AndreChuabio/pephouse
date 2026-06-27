import { MOCK_CHART_BARS } from "../../data/mockSimulation";
import { cn } from "../../lib/cn";
import type { ChartBar } from "../../types/simulation";
import { Panel } from "../ui/Panel";

const Y_AXIS_LABELS = ["100%", "75%", "50%", "25%", "0%"] as const;
const X_AXIS_LABELS = ["Base", "Q1", "Q2", "Q3", "Q4"] as const;
const GRID_LINES = [0, 25, 50, 75] as const;

type ChartBarColumnProps = {
  bar: ChartBar;
};

function ChartBarColumn({ bar }: ChartBarColumnProps) {
  return (
    <div
      className={cn("w-[8%] rounded-t-sm relative group", bar.className)}
      style={{ height: `${bar.heightPercent}%` }}
    >
      {bar.highlight && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400 ring-2 ring-zinc-950" />
      )}
      {bar.tooltip && (
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-mono text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity">
          {bar.tooltip}
        </span>
      )}
    </div>
  );
}

export function ProjectedOutcomesChart() {
  return (
    <Panel className="p-6 flex flex-col h-[400px]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">
            Projected Outcomes Matrix
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            Monte Carlo simulation (n=10,000) over 12-month horizon
          </p>
        </div>

        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md p-1">
          <button type="button" className="px-2.5 py-1 text-xs font-medium text-white bg-zinc-800 rounded shadow-sm">
            Efficacy
          </button>
          <button type="button" className="px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-300">
            Risk Profile
          </button>
        </div>
      </div>

      <div className="flex-1 w-full relative mt-4 flex items-end px-2 border-b border-zinc-800 pb-2">
        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[10px] text-zinc-600 font-mono -translate-x-full pr-4 pb-2">
          {Y_AXIS_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        {GRID_LINES.map((top) => (
          <div
            key={top}
            className="absolute inset-x-0 border-t border-zinc-800/50"
            style={{ top: `${top}%` }}
          />
        ))}

        <div className="w-full flex justify-between items-end h-full z-10 px-4">
          {MOCK_CHART_BARS.map((bar) => (
            <ChartBarColumn key={bar.id} bar={bar} />
          ))}
        </div>
      </div>

      <div className="flex justify-between w-full px-6 mt-3 text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
        {X_AXIS_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </Panel>
  );
}
