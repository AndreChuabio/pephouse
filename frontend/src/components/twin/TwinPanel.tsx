import { Icon } from "@iconify/react";
import { BodyVisualization } from "./BodyVisualization";
import { gradeFor, gradeMeta, statusMeta } from "../../lib/biomarkers";
import type { LabValue, OutcomeResult } from "../../types/simulation";
import { Panel } from "../ui/Panel";

type TwinPanelProps = {
  labs: LabValue[];
  patient: { age: number; sex: "M" | "F"; weightKg: number };
  hasImport: boolean;
  outcome: OutcomeResult | null;
  onLinkData: () => void;
};

function Sparkline({ tone }: { tone: string }) {
  const bars = [2, 3, 4, 5, 6];
  return (
    <div className="w-14 h-6 flex items-end justify-between opacity-70">
      {bars.map((h, i) => (
        <div key={i} className={`w-1 rounded-t ${tone}`} style={{ height: `${h * 4}px` }} />
      ))}
    </div>
  );
}

function BiomarkerRow({ lab }: { lab: LabValue }) {
  const meta = statusMeta(lab.status);
  const tone =
    lab.status === "high"
      ? "bg-pink-500/60"
      : lab.status === "low" || lab.status === "abnormal"
        ? "bg-amber-500/60"
        : "bg-emerald-500/60";
  return (
    <div className="flex items-center justify-between p-2.5 hover:bg-zinc-800/20 rounded-lg transition-colors">
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-zinc-200 truncate">{lab.name}</span>
        <span className="text-[10px] text-zinc-500">Blood Test · Junction</span>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex flex-col text-right w-24">
          <span className={`text-xs font-medium flex items-center justify-end gap-1 ${meta.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          <span className="text-sm text-zinc-300">
            {lab.value}
            {lab.unit ? <span className="text-[10px] text-zinc-500"> {lab.unit}</span> : null}
          </span>
        </div>
        <Sparkline tone={tone} />
      </div>
    </div>
  );
}

/** Projected-trend strip: median p50 across the simulated quarters. */
function ProjectedTrend({ outcome }: { outcome: OutcomeResult }) {
  if (outcome.distribution_void) {
    return (
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-3">
        <div className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
          <Icon icon="solar:danger-triangle-linear" /> No trial distribution
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">
          Anecdote-only compound — no controlled-trial trajectory to project.
        </p>
      </div>
    );
  }
  const qs = outcome.quarters ?? [];
  const last = qs.length ? qs[qs.length - 1] : null;
  const minP = Math.min(...qs.map((q) => q.p50), 0);
  const range = Math.max(1, Math.abs(minP));
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Icon icon="solar:graph-up-linear" className="text-blue-400" /> Projected Trajectory
        </span>
        <span className="text-[10px] text-zinc-500">
          {last ? `p50 ${last.p50.toFixed(1)}${outcome.unit ?? "%"} @ ${last.month}mo` : ""}
        </span>
      </div>
      <div className="flex items-end gap-1 h-12">
        {qs.map((q) => {
          const h = 8 + (Math.abs(q.p50) / range) * 36;
          return (
            <div
              key={q.q}
              className="flex-1 bg-gradient-to-t from-blue-600/40 to-emerald-500/70 rounded-t"
              style={{ height: `${h}px` }}
              title={`Q${q.q}: p10 ${q.p10.toFixed(1)} · p50 ${q.p50.toFixed(1)} · p90 ${q.p90.toFixed(1)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

export function TwinPanel({ labs, patient, hasImport, outcome, onLinkData }: TwinPanelProps) {
  const grade = gradeFor(labs);
  const gm = gradeMeta(grade);
  const active = hasImport || labs.length > 0;

  return (
    <Panel className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 tracking-tight flex items-center gap-2.5">
            Digital Twin
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-widest uppercase ${
                active
                  ? "border-emerald-900/50 text-emerald-500 bg-emerald-900/20"
                  : "border-zinc-700 text-zinc-500 bg-zinc-800/50"
              }`}
            >
              {active ? "Live" : "No data"}
            </span>
          </h2>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {[
              `age ${patient.age}`,
              patient.sex === "M" ? "male" : "female",
              `${patient.weightKg} kg`,
            ].join(" · ")}
          </p>
        </div>
        <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center ${gm.border} ${gm.bg}`}>
          <span className={`text-base font-bold ${gm.text}`}>{grade}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* body */}
        <div className="relative flex items-center justify-center bg-[#0a0a0a] rounded-xl border border-zinc-800/50 min-h-[320px]">
          <div className="scale-90">
            <BodyVisualization active={active} />
          </div>
        </div>

        {/* biomarkers + projected trend */}
        <div className="flex flex-col gap-3">
          {outcome && <ProjectedTrend outcome={outcome} />}
          {labs.length > 0 ? (
            <div className="space-y-0.5 max-h-[320px] overflow-y-auto pr-1">
              {labs.map((lab) => (
                <BiomarkerRow key={lab.name} lab={lab} />
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={onLinkData}
              className="flex-1 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-10 text-center text-sm text-zinc-400 hover:border-rose-700 hover:text-zinc-200 transition-colors"
            >
              <Icon icon="solar:test-tube-linear" className="text-rose-400 text-lg mb-2 mx-auto block" />
              Pull your blood panel from Junction to populate biomarkers
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
