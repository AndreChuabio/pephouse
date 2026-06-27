import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { BodyVisualization } from "../components/twin/BodyVisualization";
import {
  BODY_SYSTEMS,
  gradeFor,
  gradeMeta,
  labsForSystem,
  statusMeta,
} from "../lib/biomarkers";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useImport } from "../hooks/useImport";
import type { LabValue } from "../types/simulation";

const DEMO_COMPOUNDS = [
  { id: "bpc-157", name: "BPC-157", tag: "GRAY MKT", tagClass: "bg-zinc-800 text-zinc-400", desc: "Body Protective Compound" },
  { id: "tirzepatide", name: "Tirzepatide", tag: "FDA APPRV", tagClass: "bg-emerald-950/50 border border-emerald-900/50 text-emerald-400", desc: "GLP-1 / GIP Agonist" },
] as const;

// Decorative history sparkline (real longitudinal data is a future step).
function Sparkline({ tone }: { tone: string }) {
  const bars = [2, 3, 4, 5, 6];
  return (
    <div className="w-16 h-6 flex items-end justify-between opacity-70">
      {bars.map((h, i) => (
        <div key={i} className={`w-1 rounded-t ${tone}`} style={{ height: `${h * 4}px` }} />
      ))}
    </div>
  );
}

function BiomarkerRow({ lab }: { lab: LabValue }) {
  const meta = statusMeta(lab.status);
  const toneBar =
    lab.status === "high"
      ? "bg-pink-500/60"
      : lab.status === "low" || lab.status === "abnormal"
        ? "bg-amber-500/60"
        : "bg-emerald-500/60";
  return (
    <div className="flex items-center justify-between p-3 hover:bg-zinc-800/20 rounded-lg transition-colors group">
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-zinc-200 truncate">{lab.name}</span>
        <span className="text-[10px] text-zinc-500">Blood Test · Junction</span>
      </div>
      <div className="flex items-center gap-6">
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
        <Sparkline tone={toneBar} />
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  subtitle,
  dot,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  subtitle: string;
  dot: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-zinc-900 hover:bg-zinc-800 border text-xs p-3 rounded-xl flex flex-col gap-2 transition-colors text-left group ${
        active ? "border-blue-600/60" : "border-zinc-700/50"
      }`}
    >
      <div className="flex justify-between items-center w-full">
        <Icon icon={icon} className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" />
        <span className={`w-2 h-2 rounded-full ${dot}`} />
      </div>
      <div>
        <div className="text-zinc-200 font-semibold mb-0.5">{title}</div>
        <div className="text-[10px] text-zinc-500">{subtitle}</div>
      </div>
    </button>
  );
}

export default function DigitalTwinPage() {
  useDocumentTitle("PepHouse | Digital Twin");
  const imp = useImport();
  const [linkOpen, setLinkOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [selectedCompound, setSelectedCompound] = useState<string>("tirzepatide");

  const overallGrade = useMemo(() => gradeFor(imp.labs), [imp.labs]);
  const og = gradeMeta(overallGrade);

  const deviceWorking = imp.device === "working";
  const bloodWorking = imp.bloodwork === "working";

  return (
    <AppShell>
      <div className="flex flex-row w-full h-full overflow-hidden">
        {/* LEFT — body systems */}
        <div className="w-72 flex-shrink-0 border-r border-zinc-800/50 flex flex-col bg-[#121214] h-full overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30">
            <div>
              <div className="text-sm font-semibold text-zinc-100">Summary</div>
              <div className="text-xs text-zinc-400 mt-0.5">overall biomarkers</div>
            </div>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${og.border} ${og.bg} ${og.text} tracking-wider`}>
              {overallGrade}
            </span>
          </div>
          {BODY_SYSTEMS.map((sys) => {
            const labs = labsForSystem(imp.labs, sys.key);
            const grade = gradeFor(labs);
            const gm = gradeMeta(grade);
            return (
              <div
                key={sys.key}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 cursor-pointer border-b border-zinc-800/30 transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-zinc-300">{sys.label}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {labs.length > 0 ? `${labs.length} markers` : sys.sub}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${gm.border} ${gm.bg} ${gm.text} tracking-wider`}>
                  {grade}
                </span>
              </div>
            );
          })}
        </div>

        {/* CENTER — body visualization */}
        <div className="flex-1 flex flex-row bg-[#0a0a0a] overflow-hidden h-full">
          <div className="flex-1 relative flex flex-col items-center justify-center h-full p-8 border-r border-zinc-800/50">
            <div className="absolute top-8 left-8">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 flex items-center gap-3">
                Digital Twin
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-widest uppercase ${
                    imp.hasData
                      ? "border-emerald-900/50 text-emerald-500 bg-emerald-900/20"
                      : "border-zinc-700 text-zinc-500 bg-zinc-800/50"
                  }`}
                >
                  {imp.hasData ? "Live" : "No data"}
                </span>
              </h1>
              <p className="text-xs text-zinc-500 mt-1">
                {imp.hasData
                  ? "Simulating physiology from your linked data."
                  : "Link your data to bring the twin to life."}
              </p>
              {(imp.age != null || imp.sex || imp.weightKg != null) && (
                <div className="mt-3 text-xs text-zinc-400 font-mono">
                  {[
                    imp.age != null ? `age ${imp.age}` : null,
                    imp.sex ? (imp.sex === "M" ? "male" : "female") : null,
                    imp.weightKg != null ? `${imp.weightKg} kg` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
            <BodyVisualization active={imp.hasData} />
          </div>

          {/* RIGHT — data + actions */}
          <div className="w-[480px] flex-shrink-0 bg-[#121214] h-full overflow-y-auto flex flex-col">
            <div className="p-6 border-b border-zinc-800/50 bg-[#0a0a0a]">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <ActionCard
                  icon="lucide:link"
                  title="Link Data"
                  subtitle="Oura, Labs via Junction"
                  dot={imp.hasData ? "bg-emerald-500" : "bg-zinc-600"}
                  active={linkOpen}
                  onClick={() => setLinkOpen((v) => !v)}
                />
                <ActionCard
                  icon="lucide:target"
                  title="Goals & Stack"
                  subtitle="Define target states"
                  dot="bg-amber-500"
                  active={goalsOpen}
                  onClick={() => setGoalsOpen((v) => !v)}
                />
              </div>

              {linkOpen && (
                <div className="mb-4 rounded-xl border border-zinc-800 bg-[#121214]/60 p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={imp.connectDevice}
                      disabled={deviceWorking}
                      className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-200 hover:border-blue-700 hover:bg-blue-950/20 disabled:opacity-60 transition-colors"
                    >
                      <Icon icon={deviceWorking ? "svg-spinners:180-ring" : "lucide:watch"} className="text-blue-400" />
                      {imp.device === "done" ? "Wearable linked" : deviceWorking ? "Waiting…" : "Connect wearable"}
                    </button>
                    <button
                      type="button"
                      onClick={imp.pullBloodwork}
                      disabled={bloodWorking}
                      className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-200 hover:border-rose-700 hover:bg-rose-950/20 disabled:opacity-60 transition-colors"
                    >
                      <Icon icon={bloodWorking ? "svg-spinners:180-ring" : "lucide:test-tube"} className="text-rose-400" />
                      {imp.bloodwork === "done" ? "Bloodwork pulled" : bloodWorking ? "Pulling…" : "Pull blood panel"}
                    </button>
                  </div>
                  {imp.device === "error" && (
                    <button
                      type="button"
                      onClick={imp.recheckDevice}
                      className="w-full rounded-lg border border-blue-800/60 bg-blue-950/20 px-3 py-1.5 text-[11px] text-blue-300 hover:bg-blue-950/40"
                    >
                      I've connected — re-check
                    </button>
                  )}
                  {imp.error && <p className="text-[11px] text-amber-400">{imp.error}</p>}
                  {imp.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {imp.conditions.map((c) => (
                        <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/50 border border-amber-800/60 text-amber-300">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {goalsOpen && (
                <div className="mb-4 rounded-xl border border-zinc-800 bg-[#121214]/60 p-3 text-[11px] text-zinc-500">
                  Goals & current stack entry — next step. Your linked profile and
                  bloodwork will seed the simulation here.
                </div>
              )}

              {/* Compound selector */}
              <div className="bg-[#121214]/50 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center gap-2.5 text-base font-medium text-zinc-100">
                  <Icon icon="lucide:test-tube" className="w-5 h-5 text-zinc-400" />
                  Compound
                </div>
                {DEMO_COMPOUNDS.map((c) => {
                  const sel = selectedCompound === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCompound(c.id)}
                      className={`bg-transparent rounded-xl p-4 flex flex-col text-left transition-colors ${
                        sel ? "border border-blue-500 ring-1 ring-blue-500" : "border border-zinc-700 hover:bg-zinc-800/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[15px] font-medium text-zinc-100">{c.name}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded tracking-wider uppercase ${c.tagClass}`}>
                          {c.tag}
                        </span>
                      </div>
                      <div className="text-[13px] text-zinc-500">{c.desc}</div>
                    </button>
                  );
                })}
                <div className="flex items-start gap-2.5">
                  <Icon icon="lucide:info" className="w-[15px] h-[15px] text-zinc-500 shrink-0 mt-0.5" />
                  <span className="text-[13px] text-zinc-500 leading-snug">
                    Tirzepatide (trial curve) vs BPC-157 (anecdote void).
                  </span>
                </div>
              </div>
            </div>

            {/* Biomarker panel */}
            <div className="p-6 flex-1 flex flex-col gap-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Health Summary</h2>
                  <p className="text-xs text-zinc-400 mt-2 leading-relaxed max-w-[280px]">
                    {imp.labs.length > 0
                      ? "Biomarkers pulled from your linked Junction lab panel."
                      : "Link a blood panel to populate your biomarkers."}
                  </p>
                </div>
                <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${og.border} ${og.bg}`}>
                  <span className={`text-lg font-bold ${og.text}`}>{overallGrade}</span>
                </div>
              </div>

              {/* Projected trend (goal/projection wiring is the next step) */}
              <div className="bg-zinc-800/30 border border-zinc-800/50 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Icon icon="lucide:trending-up" className="w-3.5 h-3.5 text-blue-400" />
                    Projected Trend
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {DEMO_COMPOUNDS.find((c) => c.id === selectedCompound)?.name}
                  </span>
                </div>
                <div className="text-sm font-medium text-zinc-400 mb-2">
                  Set a goal & run a projection to see your trajectory.
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 w-[8%] rounded-full" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-zinc-500 mb-2 px-1 uppercase">
                  <span>Name</span>
                  <div className="flex gap-14 mr-4">
                    <span>Status</span>
                    <span>History</span>
                  </div>
                </div>
                {imp.labs.length > 0 ? (
                  <div className="space-y-1">
                    {imp.labs.map((lab) => (
                      <BiomarkerRow key={lab.name} lab={lab} />
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setLinkOpen(true);
                      imp.pullBloodwork();
                    }}
                    className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-400 hover:border-rose-700 hover:text-zinc-200 transition-colors"
                  >
                    <Icon icon="lucide:test-tube" className="text-rose-400 text-lg mb-2 mx-auto block" />
                    Pull your blood panel from Junction
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
