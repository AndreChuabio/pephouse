import { Icon } from "@iconify/react";
import type { CompoundProfile, SimulationSnapshot } from "../../data/simulation2";
import { cn } from "../../lib/cn";

type BreakdownModalProps = {
  open: boolean;
  onClose: () => void;
  compound: CompoundProfile;
  snapshot: SimulationSnapshot;
};

const SIDE_EFFECT_TIMELINE = [
  { label: "Day 1", height: 20, note: "20% Incidence" },
  { label: "Day 7", height: 45, note: "45% Incidence" },
  { label: "Day 14", height: 60, note: "60% Incidence" },
  { label: "Day 21", height: 85, note: "85% Projected Risk", faded: true },
  { label: "Day 28", height: 95, note: "95% Projected Risk", faded: true },
];

export function BreakdownModal({ open, onClose, compound, snapshot }: BreakdownModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-end">
      <div className="bg-[#121212] border-l border-zinc-800 w-full max-w-xl h-full flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800/50 flex items-center justify-between shrink-0 bg-[#0A0A0A]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded border border-zinc-800 flex items-center justify-center bg-zinc-900">
              <Icon icon="solar:chart-2-linear" className="text-zinc-400 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-medium tracking-tight text-zinc-100">
                Simulation Breakdown & Graph
              </h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Comprehensive view of projected outcomes
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-2 rounded-md hover:bg-zinc-800"
            aria-label="Close breakdown"
          >
            <Icon icon="solar:close-circle-linear" className="text-xl" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 min-h-0">
          <div className="flex-1 space-y-4">
            <h3 className="text-sm font-medium tracking-tight text-zinc-100 flex items-center gap-2">
              <Icon icon="solar:danger-triangle-linear" className="text-zinc-500" />
              Side Effects Projection Graph
            </h3>
            <div className="h-64 w-full bg-[#0A0A0A] border border-zinc-800 rounded-lg p-4 relative flex items-end gap-4 justify-between">
              <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none opacity-20">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="w-full h-px bg-zinc-700" />
                ))}
              </div>
              <div className="relative w-full h-full flex items-end justify-around pb-6 pt-4">
                {SIDE_EFFECT_TIMELINE.map((bar) => (
                  <div
                    key={bar.label}
                    className={`w-12 hover:opacity-90 transition-colors rounded-t-sm h-[${bar.height}%] relative group ${
                      bar.faded ? "bg-zinc-100 opacity-40" : "bg-zinc-800 hover:bg-zinc-700"
                    }`}
                    style={{ height: `${bar.height}%` }}
                  >
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500 whitespace-nowrap">
                      {bar.label}
                    </span>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-100 text-zinc-900 text-[10px] py-1 px-2 rounded hidden group-hover:block whitespace-nowrap z-10">
                      {bar.note}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
                <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">
                  Peak Side Effects
                </h4>
                <span className="text-lg font-medium text-zinc-100">Day 21–28</span>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
                <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">
                  Confidence Score
                </h4>
                <span className="text-lg font-medium text-amber-500">
                  {snapshot.confidenceScore}% ({snapshot.degraded ? "Degraded" : snapshot.confidenceLevel})
                </span>
              </div>
            </div>
          </div>

          <div className="w-full flex flex-col space-y-6">
            <div className="space-y-4">
              <h3 className="text-sm font-medium tracking-tight text-zinc-100 flex items-center gap-2 border-b border-zinc-800 pb-2">
                <Icon icon="solar:document-text-linear" className="text-zinc-500" />
                Detailed Breakdown — {compound.name}
              </h3>
              <div className="space-y-3 text-xs">
                {compound.benefits.map((b, i) => (
                  <div
                    key={b.label}
                    className={cn("space-y-1", i > 0 && "pt-2 border-t border-zinc-800/50")}
                  >
                    <div className="flex justify-between text-zinc-300">
                      <span>{b.label}</span>
                      <span className="text-zinc-500">{b.probabilityLabel ?? `${b.percent}%`}</span>
                    </div>
                    {b.detail && <p className="text-[10px] text-zinc-500 leading-relaxed">{b.detail}</p>}
                  </div>
                ))}
                {compound.sideEffects.map((risk) => (
                  <div
                    key={risk.label}
                    className={cn("space-y-1 pt-2 border-t border-zinc-800/50", risk.severity === "elevated" && "text-red-400")}
                  >
                    <div className="flex justify-between">
                      <span>{risk.label}</span>
                      <span className={risk.severity === "elevated" ? "text-red-500" : "text-zinc-500"}>
                        {risk.probabilityLabel ?? `${risk.percent}%`}
                      </span>
                    </div>
                    {risk.detail && (
                      <p
                        className={cn(
                          "text-[10px] leading-relaxed",
                          risk.severity === "elevated" ? "text-red-300/80" : "text-zinc-500",
                        )}
                      >
                        {risk.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-auto pt-4">
              <button
                type="button"
                className="w-full py-2 bg-[#0A0A0A] border border-zinc-700 hover:bg-zinc-800 text-zinc-100 rounded-md text-xs font-medium transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <Icon icon="solar:download-minimalistic-linear" />
                Download CSV Data
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
