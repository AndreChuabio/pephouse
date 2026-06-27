import { Icon } from "@iconify/react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { BodyVisualization } from "../components/twin/BodyVisualization";
import { saveUserData } from "../lib/api";
import { getUserRef } from "../lib/userRef";
import { DEMOGRAPHICS } from "../data/mockSimulation";
import {
  BODY_SYSTEMS,
  gradeFor,
  gradeMeta,
  labsForSystem,
  statusMeta,
} from "../lib/biomarkers";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useImport } from "../hooks/useImport";
import { useSimulation } from "../hooks/useSimulation";
import type { LabValue, OutcomeResult, PatientInput } from "../types/simulation";

// realId = registry compound_id used by POST /simulate (BPC-157=1, Tirzepatide=3).
const DEMO_COMPOUNDS = [
  { id: "bpc-157", realId: 1, name: "BPC-157", tag: "GRAY MKT", tagClass: "bg-zinc-800 text-zinc-400", desc: "Body Protective Compound" },
  { id: "tirzepatide", realId: 3, name: "Tirzepatide", tag: "FDA APPRV", tagClass: "bg-emerald-950/50 border border-emerald-900/50 text-emerald-400", desc: "GLP-1 / GIP Agonist" },
] as const;

const AGE_PRESETS = [10, 25, 35, 45, 55, 65, 75];

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
  working,
  onClick,
}: {
  icon: string;
  title: string;
  subtitle: string;
  dot: string;
  working?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 text-xs p-3 rounded-xl flex flex-col gap-2 transition-colors text-left group"
    >
      <div className="flex justify-between items-center w-full">
        <Icon icon={working ? "svg-spinners:180-ring" : icon} className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" />
        <span className={`w-2 h-2 rounded-full ${dot}`} />
      </div>
      <div>
        <div className="text-zinc-200 font-semibold mb-0.5">{title}</div>
        <div className="text-[10px] text-zinc-500">{subtitle}</div>
      </div>
    </button>
  );
}

function ProjectedTrajectory({
  outcome,
  loading,
  compoundName,
  excludedReason,
}: {
  outcome: OutcomeResult | null;
  loading: boolean;
  compoundName: string;
  excludedReason?: string | null;
}) {
  return (
    <div className="bg-zinc-800/30 border border-zinc-800/50 rounded-xl p-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Icon icon="lucide:trending-up" className="w-3.5 h-3.5 text-blue-400" />
          Projected Trajectory
        </span>
        <span className="text-[10px] text-zinc-500">{compoundName}</span>
      </div>
      {loading ? (
        <div className="text-sm text-zinc-400 flex items-center gap-2">
          <Icon icon="svg-spinners:180-ring" className="text-blue-400" /> Running Monte Carlo…
        </div>
      ) : excludedReason ? (
        <div className="text-sm text-amber-300">
          {compoundName} excluded — {excludedReason.replace(/_/g, " ")}. Patient is
          outside the trial's eligibility window.
        </div>
      ) : !outcome ? (
        <div className="text-sm font-medium text-zinc-400">
          Run a simulation to project your trajectory.
        </div>
      ) : outcome.distribution_void ? (
        <div className="text-sm text-amber-300">
          No controlled-trial distribution — {compoundName} is anecdote-only. The twin
          can't honestly project a curve.
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold text-emerald-400 mb-2">
            {outcome.p50 != null
              ? `${outcome.p50.toFixed(1)}${outcome.unit ?? "%"} median by month ${
                  outcome.quarters.at(-1)?.month ?? 12
                }`
              : "Projection ready"}
          </div>
          <div className="flex items-end gap-1 h-14">
            {outcome.quarters.map((q) => {
              const maxAbs = Math.max(1, ...outcome.quarters.map((x) => Math.abs(x.p50)));
              const h = 8 + (Math.abs(q.p50) / maxAbs) * 40;
              return (
                <div
                  key={q.q}
                  className="flex-1 bg-gradient-to-t from-blue-600/40 to-emerald-500/70 rounded-t"
                  style={{ height: `${h}px` }}
                  title={`Q${q.q} (m${q.month}): p10 ${q.p10.toFixed(1)} · p50 ${q.p50.toFixed(1)} · p90 ${q.p90.toFixed(1)}`}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MetricChip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex-1 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
      <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mb-1">
        <Icon icon={icon} /> {label}
      </div>
      <div className="text-sm font-semibold text-zinc-200">{value}</div>
    </div>
  );
}

export default function DigitalTwinPage() {
  useDocumentTitle("PepHouse | Digital Twin");
  const imp = useImport();
  const { result, loading, run } = useSimulation();
  const [selectedCompounds, setSelectedCompounds] = useState<string[]>(["tirzepatide"]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Editable patient profile — seeded by DEMOGRAPHICS, overwritten by imports,
  // edited by the user, persisted to user_profiles via the explicit Save button.
  const [patient, setPatient] = useState<PatientInput>(DEMOGRAPHICS);

  // Imported wearable profile flows into the editable demographics.
  useEffect(() => {
    setPatient((prev) => ({
      ...prev,
      ...(imp.age != null ? { age: imp.age } : {}),
      ...(imp.sex ? { sex: imp.sex } : {}),
      ...(imp.weightKg != null ? { weightKg: imp.weightKg } : {}),
      conditions: imp.conditions.length ? imp.conditions : prev.conditions,
    }));
  }, [imp.age, imp.sex, imp.weightKg, imp.conditions]);

  // Local edit only — Save persists it.
  const editProfile = (partial: Partial<PatientInput>) => {
    setPatient((prev) => ({ ...prev, ...partial }));
    setSaveState("idle");
  };

  // Explicit save -> POST /users/{ref}/data (labs untouched on a profile save).
  const handleSave = async () => {
    setSaveState("saving");
    try {
      await saveUserData(getUserRef(), {
        age: patient.age,
        sex: patient.sex,
        weightKg: patient.weightKg,
        conditions: patient.conditions,
        source: { kind: "reported", label: "Manual entry", at: new Date().toISOString() },
      });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  };

  const toggleCompound = (id: string) =>
    setSelectedCompounds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedReal = DEMO_COMPOUNDS.filter((c) => selectedCompounds.includes(c.id));
  const overallGrade = useMemo(() => gradeFor(imp.labs), [imp.labs]);
  const og = gradeMeta(overallGrade);

  // Per-compound weight outcome / exclusion from the (possibly multi-compound) run.
  const outcomeFor = (realId: number) =>
    result?.outcomes.find((o) => o.compound_id === realId && o.outcome_name === "weight_change_pct") ?? null;
  const excludedFor = (realId: number) =>
    result?.excluded_priors?.find((e) => e.compound_id === realId)?.reason ?? null;
  // Prefer a real (non-void) outcome for the headline P metric.
  const primaryOutcome =
    selectedReal.map((c) => outcomeFor(c.realId)).find((o) => o && !o.distribution_void) ??
    (selectedReal.length ? outcomeFor(selectedReal[0].realId) : null);

  const ageOptions = useMemo(
    () => Array.from(new Set([...AGE_PRESETS, patient.age])).sort((a, b) => a - b),
    [patient.age],
  );
  const weightPct = Math.min(100, Math.max(0, (patient.weightKg / 300) * 100));

  const handleRun = () => {
    if (!selectedReal.length) return;
    run(selectedReal.map((c) => c.realId), patient, { tiers: ["trial"] });
  };
  // Link Data → actually pull bloodwork (populates the biomarkers below) and
  // kick off the wearable connect (Junction Link) if not already linked.
  const handleLinkData = () => {
    imp.pullBloodwork();
    if (imp.device === "idle") imp.connectDevice();
  };

  return (
    <AppShell>
      <div className="flex flex-row w-full h-full overflow-hidden">
        {/* LEFT — inputs (demographic + compound) then body systems */}
        <div className="w-[340px] flex-shrink-0 border-r border-zinc-800/50 flex flex-col bg-[#121214] h-full overflow-y-auto">
          <div className="p-4 flex flex-col gap-4 border-b border-zinc-800/30">
            {/* Base Demographic (editable, live-saved) */}
            <div className="bg-[#121214]/50 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2.5 text-base font-medium text-zinc-100">
                <Icon icon="lucide:user" className="w-5 h-5 text-zinc-400" />
                Base Demographic (Twin)
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[12px] font-medium text-zinc-500 mb-1.5 block">Age</label>
                  <select
                    value={patient.age}
                    onChange={(e) => editProfile({ age: Number(e.target.value) })}
                    className="w-full bg-[#0a0a0a] border border-zinc-700/80 rounded-lg py-2 px-3 text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors cursor-pointer"
                  >
                    {ageOptions.map((a) => (
                      <option key={a} value={a}>{a} years</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[12px] font-medium text-zinc-500 mb-1.5 block">Sex</label>
                  <select
                    value={patient.sex}
                    onChange={(e) => editProfile({ sex: e.target.value as "M" | "F" })}
                    className="w-full bg-[#0a0a0a] border border-zinc-700/80 rounded-lg py-2 px-3 text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors cursor-pointer"
                  >
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
              </div>
              <div className="mt-1">
                <div className="flex justify-between items-end mb-2.5">
                  <span className="text-[12px] font-medium text-zinc-500">Weight (baseline)</span>
                  <span className="text-xs text-zinc-300 font-mono">
                    {patient.weightKg}
                    <span className="text-zinc-500 font-sans ml-0.5">kg</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={300}
                  value={patient.weightKg}
                  onChange={(e) => editProfile({ weightKg: Number(e.target.value) })}
                  className="w-full accent-blue-500"
                  aria-label="Weight in kilograms"
                  style={{ background: `linear-gradient(to right, #3b82f6 ${weightPct}%, #27272a ${weightPct}%)` }}
                />
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={saveState === "saving"}
                className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${
                  saveState === "saved"
                    ? "bg-emerald-600/90 text-white"
                    : saveState === "error"
                      ? "bg-amber-600/90 text-white"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700"
                }`}
              >
                <Icon
                  icon={
                    saveState === "saving"
                      ? "svg-spinners:180-ring"
                      : saveState === "saved"
                        ? "lucide:check"
                        : "lucide:save"
                  }
                  className="w-4 h-4"
                />
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Saved to profile"
                    : saveState === "error"
                      ? "Retry save"
                      : "Save to profile"}
              </button>
            </div>

            {/* Compound */}
            <div className="bg-[#121214]/50 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2.5 text-base font-medium text-zinc-100">
                <Icon icon="lucide:test-tube" className="w-5 h-5 text-zinc-400" />
                Compound
              </div>
              {DEMO_COMPOUNDS.map((c) => {
                const sel = selectedCompounds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCompound(c.id)}
                    aria-pressed={sel}
                    className={`bg-transparent rounded-xl p-4 flex flex-col text-left transition-colors relative ${
                      sel ? "border border-blue-500 ring-1 ring-blue-500" : "border border-zinc-700 hover:bg-zinc-800/30"
                    }`}
                  >
                    <span
                      className={`absolute top-3 right-3 w-4 h-4 rounded border flex items-center justify-center ${
                        sel ? "bg-blue-500 border-blue-500" : "border-zinc-600"
                      }`}
                    >
                      {sel && <Icon icon="lucide:check" className="w-3 h-3 text-white" />}
                    </span>
                    <div className="flex items-center gap-3 mb-1 pr-6">
                      <span className="text-[15px] font-medium text-zinc-100">{c.name}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded tracking-wider uppercase ${c.tagClass}`}>
                        {c.tag}
                      </span>
                    </div>
                    <div className="text-[13px] text-zinc-500">{c.desc}</div>
                  </button>
                );
              })}
              <div className="flex items-start gap-2.5 mt-1">
                <Icon icon="lucide:info" className="w-[15px] h-[15px] text-zinc-500 shrink-0 mt-0.5" />
                <span className="text-[13px] text-zinc-500 leading-snug">
                  Select one or more to stack. {selectedReal.length} selected · Tirzepatide
                  (trial curve) vs BPC-157 (void); age 10 → excluded.
                </span>
              </div>
              <button
                type="button"
                onClick={handleRun}
                disabled={loading || selectedReal.length === 0}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
              >
                <Icon icon={loading ? "svg-spinners:180-ring" : "lucide:play"} />
                {loading
                  ? "Simulating…"
                  : `Run Simulation${selectedReal.length > 1 ? ` (${selectedReal.length})` : ""}`}
              </button>
            </div>
          </div>

          {/* Body systems */}
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
              <div className="mt-3 text-xs text-zinc-400 font-mono">
                {[`age ${patient.age}`, patient.sex === "M" ? "male" : "female", `${patient.weightKg} kg`].join(" · ")}
              </div>
            </div>
            <BodyVisualization active={imp.hasData} />
          </div>

          {/* RIGHT — link data + simulation output */}
          <div className="w-[480px] flex-shrink-0 bg-[#121214] h-full overflow-y-auto flex flex-col">
            <div className="p-6 border-b border-zinc-800/50 bg-[#0a0a0a]">
              <div className="grid grid-cols-2 gap-3">
                <ActionCard
                  icon="lucide:link"
                  title="Link Data"
                  subtitle="Oura, Labs via Junction"
                  dot={imp.hasData ? "bg-emerald-500" : "bg-zinc-600"}
                  working={imp.bloodwork === "working" || imp.device === "working"}
                  onClick={handleLinkData}
                />
                <ActionCard
                  icon="lucide:target"
                  title="Goals & Stack"
                  subtitle="Define target states"
                  dot="bg-amber-500"
                  onClick={() => {}}
                />
              </div>
              {imp.device === "error" && (
                <button
                  type="button"
                  onClick={imp.recheckDevice}
                  className="mt-3 w-full rounded-lg border border-blue-800/60 bg-blue-950/20 px-3 py-2 text-xs text-blue-300 hover:bg-blue-950/40"
                >
                  I've connected my wearable — re-check
                </button>
              )}
              {imp.error && <p className="mt-3 text-[11px] text-amber-400">{imp.error}</p>}
              {(imp.deviceLabel || imp.bloodworkLabel) && (
                <p className="mt-3 text-[10px] text-zinc-500">
                  {[imp.deviceLabel, imp.bloodworkLabel].filter(Boolean).join(" · ")} — saved to your profile.
                </p>
              )}
            </div>

            <div className="p-6 flex-1 flex flex-col gap-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Health Summary</h2>
                  <p className="text-xs text-zinc-400 mt-2 leading-relaxed max-w-[280px]">
                    {imp.labs.length > 0
                      ? "Biomarkers pulled from your linked Junction lab panel."
                      : "Click Link Data to pull your blood panel and populate biomarkers."}
                  </p>
                </div>
                <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${og.border} ${og.bg}`}>
                  <span className={`text-lg font-bold ${og.text}`}>{overallGrade}</span>
                </div>
              </div>

              {/* My result — one trajectory per selected compound */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                    My Result
                  </span>
                  {result && !loading && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <Icon icon="lucide:check" className="w-3 h-3" /> simulation complete
                    </span>
                  )}
                </div>
                {selectedReal.length === 0 ? (
                  <div className="bg-zinc-800/30 border border-zinc-800/50 rounded-xl p-4 text-sm text-zinc-400">
                    Select a compound on the left, then Run Simulation.
                  </div>
                ) : (
                  selectedReal.map((c) => (
                    <ProjectedTrajectory
                      key={c.id}
                      outcome={outcomeFor(c.realId)}
                      loading={loading}
                      compoundName={c.name}
                      excludedReason={excludedFor(c.realId)}
                    />
                  ))
                )}
              </div>

              <div className="flex gap-3">
                <MetricChip icon="lucide:users" label="Cohort match" value={result ? (result.cohort_n === 0 ? "No match" : `${result.cohort_n}`) : "—"} />
                <MetricChip icon="lucide:shield-check" label="Confidence" value={result?.data_confidence ?? "—"} />
                <MetricChip
                  icon="lucide:bar-chart-2"
                  label="P(≥15% loss)"
                  value={primaryOutcome?.prob_threshold != null ? `${Math.round(primaryOutcome.prob_threshold * 100)}%` : "—"}
                />
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
                    onClick={handleLinkData}
                    className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-400 hover:border-rose-700 hover:text-zinc-200 transition-colors"
                  >
                    <Icon icon="lucide:test-tube" className="text-rose-400 text-lg mb-2 mx-auto block" />
                    Click to pull your blood panel from Junction
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
