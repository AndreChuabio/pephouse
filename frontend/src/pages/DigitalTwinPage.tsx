import { Icon } from "@iconify/react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { BodyVisualization } from "../components/twin/BodyVisualization";
import { MultiSelectDropdown } from "../components/twin/MultiSelectDropdown";
import { saveUserData, twinSimulate } from "../lib/api";
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
import { useCompoundExtras } from "../hooks/useCompoundExtras";
import { useStack } from "../hooks/useStack";
import type { LabValue, OutcomeResult, PatientInput, SimulateResponse } from "../types/simulation";

const GOAL_OPTIONS = [
  "More energy",
  "More healthy years",
  "Prevent chronic illness",
  "Support peak performance",
  "Proactive healthcare",
  "Optimize my biomarkers",
  "Mental clarity",
  "To look my best",
  "Support my metabolism",
  "Revitalize my sexual health",
  "Lose weight",
  "Optimize muscle composition",
  "Support menopause / perimenopause",
  "Support my cardiovascular health",
  "Cellular rejuvenation (NAD+ / Glutathione)",
];

const SOURCE_OPTIONS = [
  { value: "label_dose", label: "Label dose (no source modeling)" },
  { value: "compounding_pharmacy", label: "Compounding pharmacy (clean)" },
  { value: "vendor_tested", label: "Gray-market, lab-tested" },
  { value: "gray_market", label: "Gray-market, untested" },
];

const CONDITION_OPTIONS = [
  "Diabetes",
  "High cholesterol",
  "Prediabetes",
  "Hypertension",
  "Obesity",
  "Hypothyroidism",
  "PCOS",
  "Fatty liver",
  "Low testosterone",
  "Anxiety",
  "Insomnia",
];

// realId = registry compound_id used by /twin/simulate (BPC-157=1, Tirzepatide=3).
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

// Translate a weight_change_pct outcome into an actual weight delta (kg).
function weightProjection(outcome: OutcomeResult, baselineKg: number) {
  if (outcome.outcome_name !== "weight_change_pct" || outcome.p50 == null) return null;
  const projected = baselineKg * (1 + outcome.p50 / 100);
  return { from: baselineKg, to: Math.round(projected * 10) / 10, delta: Math.round((projected - baselineKg) * 10) / 10 };
}

function ProjectedTrajectory({
  outcome,
  loading,
  compoundName,
  excludedReason,
  baselineWeightKg,
}: {
  outcome: OutcomeResult | null;
  loading: boolean;
  compoundName: string;
  excludedReason?: string | null;
  baselineWeightKg: number;
}) {
  const unit = outcome?.unit === "percent" ? "%" : outcome?.unit ?? "%";
  const wp = outcome ? weightProjection(outcome, baselineWeightKg) : null;
  return (
    <div className="bg-zinc-800/30 border border-zinc-800/50 rounded-xl p-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Icon icon="lucide:trending-up" className="w-3.5 h-3.5 text-cyan-400" />
          Projected Trajectory
        </span>
        <span className="text-[10px] text-zinc-500">{compoundName}</span>
      </div>
      {loading ? (
        <div className="text-sm text-zinc-400 flex items-center gap-2">
          <Icon icon="svg-spinners:180-ring" className="text-cyan-400" /> Running Monte Carlo…
        </div>
      ) : excludedReason ? (
        <div className="text-sm text-amber-300">
          {compoundName} excluded — {excludedReason.replace(/_/g, " ")}. Patient is outside the
          trial's eligibility window.
        </div>
      ) : outcome?.distribution_void ? (
        <div className="text-sm text-amber-300">
          No controlled-trial distribution — {compoundName} is anecdote-only. The twin can't
          honestly project a curve.
        </div>
      ) : outcome ? (
        <>
          {/* actual metric change (weight) */}
          {wp ? (
            <div className="mb-2">
              <div className="text-base font-semibold text-emerald-400">
                Weight {wp.from} kg → {wp.to} kg
                <span className="text-zinc-500 text-sm font-normal"> ({wp.delta > 0 ? "+" : ""}{wp.delta} kg · {outcome.p50!.toFixed(1)}%)</span>
              </div>
              <div className="text-[10px] text-zinc-500">median over {(outcome.quarters ?? []).at(-1)?.month ?? 12} months</div>
            </div>
          ) : (
            <div className="text-sm font-semibold text-emerald-400 mb-2">
              {outcome.p50 != null ? `${outcome.p50.toFixed(1)}${unit} median` : "Projection ready"}
            </div>
          )}
          <div className="flex items-end gap-1 h-14">
            {(outcome.quarters ?? []).map((q) => {
              const maxAbs = Math.max(1, ...(outcome.quarters ?? []).map((x) => Math.abs(x.p50)));
              const h = 8 + (Math.abs(q.p50) / maxAbs) * 40;
              return (
                <div
                  key={q.q}
                  className="flex-1 bg-gradient-to-t from-cyan-600/40 to-emerald-500/70 rounded-t"
                  style={{ height: `${h}px` }}
                  title={`Q${q.q} (m${q.month}): p10 ${q.p10.toFixed(1)} · p50 ${q.p50.toFixed(1)} · p90 ${q.p90.toFixed(1)}`}
                />
              );
            })}
          </div>
          {/* distribution spread, like the Arena's Projected Outcomes */}
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div><div className="text-[9px] text-zinc-500 uppercase tracking-wider">p10</div><div className="text-xs text-zinc-300">{outcome.p10?.toFixed(1)}{unit}</div></div>
            <div><div className="text-[9px] text-zinc-500 uppercase tracking-wider">mean</div><div className="text-xs text-zinc-300">{outcome.mean?.toFixed(1)}{unit}</div></div>
            <div><div className="text-[9px] text-zinc-500 uppercase tracking-wider">p90</div><div className="text-xs text-zinc-300">{outcome.p90?.toFixed(1)}{unit}</div></div>
          </div>
        </>
      ) : null}
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

// A connectable data source (blood panel / wearable): connect when off, green +
// disconnect when on.
function SourceCard({
  title,
  subtitle,
  icon,
  connected,
  working,
  onConnect,
  onDisconnect,
}: {
  title: string;
  subtitle: string;
  icon: string;
  connected: boolean;
  working: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={connected ? onDisconnect : onConnect}
      disabled={working}
      className={`text-xs p-3 rounded-xl flex flex-col gap-2 transition-colors text-left group border disabled:opacity-70 ${
        connected
          ? "bg-emerald-950/20 border-emerald-800/40 hover:bg-rose-950/20 hover:border-rose-800/50"
          : "bg-zinc-900 hover:bg-zinc-800 border-zinc-700/50"
      }`}
    >
      <div className="flex justify-between items-center w-full">
        <Icon
          icon={working ? "svg-spinners:180-ring" : connected ? "lucide:check-circle-2" : icon}
          className={`w-4 h-4 ${connected ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"}`}
        />
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-600"}`} />
      </div>
      <div>
        <div className="text-zinc-200 font-semibold mb-0.5">{title}</div>
        <div className="text-[10px] text-zinc-500">
          {connected ? "Connected · click to disconnect" : working ? "Pulling…" : subtitle}
        </div>
      </div>
    </button>
  );
}

function WearableStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg px-3 py-2 flex items-center gap-2.5">
      <Icon icon={icon} className="w-4 h-4 text-cyan-400 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] text-zinc-500">{label}</div>
        <div className="text-sm font-semibold text-zinc-200 truncate">{value}</div>
      </div>
    </div>
  );
}

// Health score 0–100 from biomarker statuses (penalize out-of-range markers).
function healthScore(labs: LabValue[]): number | null {
  if (!labs.length) return null;
  let penalty = 0;
  for (const l of labs) {
    if (l.status === "high") penalty += 12;
    else if (l.status === "low") penalty += 8;
    else if (l.status === "abnormal") penalty += 8;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export default function DigitalTwinPage() {
  useDocumentTitle("PepHouse | Digital Twin");
  const imp = useImport();
  const connected = imp.connected;

  const { stack, add: addToStack, remove: removeFromStack } = useStack();
  // Per-compound draft inputs (dose + source) before "Add to my Stack".
  const [draftDose, setDraftDose] = useState<Record<number, string>>({});
  const [draftSource, setDraftSource] = useState<Record<number, string>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Simulation defaults (controls UI removed; per-compound source comes from the stack).
  const tiers = ["trial"];
  const nDraws = 5000;

  // Simulation result — only populated after Run.
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Editable patient profile.
  const [patient, setPatient] = useState<PatientInput>({ ...DEMOGRAPHICS, conditions: [], goals: [] });
  useEffect(() => {
    setPatient((prev) => ({
      ...prev,
      ...(imp.age != null ? { age: imp.age } : {}),
      ...(imp.sex ? { sex: imp.sex } : {}),
      ...(imp.weightKg != null ? { weightKg: imp.weightKg } : {}),
      conditions: imp.conditions.length ? imp.conditions : prev.conditions,
      goals: imp.goals.length ? imp.goals : prev.goals,
    }));
  }, [imp.age, imp.sex, imp.weightKg, imp.conditions, imp.goals]);

  const editProfile = (partial: Partial<PatientInput>) => {
    setPatient((prev) => ({ ...prev, ...partial }));
    setSaveState("idle");
  };

  const handleSave = async () => {
    setSaveState("saving");
    try {
      await saveUserData(getUserRef(), {
        age: patient.age,
        sex: patient.sex,
        weightKg: patient.weightKg,
        conditions: patient.conditions ?? [],
        goals: patient.goals ?? [],
        source: { kind: "reported", label: "Manual entry", at: new Date().toISOString() },
      });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  };

  const compoundExtras = useCompoundExtras(DEMO_COMPOUNDS.map((c) => c.realId));

  // The compounds in the stack, resolved to the demo metadata (for trajectories).
  const stackReal = stack
    .map((s) => ({ item: s, def: DEMO_COMPOUNDS.find((c) => c.realId === s.compound_id) }))
    .filter((x): x is { item: typeof stack[number]; def: (typeof DEMO_COMPOUNDS)[number] } => Boolean(x.def));
  const inStack = (realId: number) => stack.some((s) => s.compound_id === realId);

  const handleAddToStack = (c: (typeof DEMO_COMPOUNDS)[number]) => {
    const dose = draftDose[c.realId] ?? compoundExtras[c.realId]?.dose ?? "";
    const source_type = draftSource[c.realId] ?? "label_dose";
    addToStack({ compound_id: c.realId, compound_name: c.name, dose, source_type });
  };

  const overallGrade = useMemo(() => gradeFor(imp.labs), [imp.labs]);
  const og = gradeMeta(overallGrade);
  const score = useMemo(() => healthScore(imp.labs), [imp.labs]);

  const outcomeFor = (realId: number) =>
    result?.outcomes?.find((o) => o.compound_id === realId && o.outcome_name === "weight_change_pct") ?? null;
  const excludedFor = (realId: number) =>
    result?.excluded_priors?.find((e) => e.compound_id === realId)?.reason ?? null;
  const primaryOutcome =
    stackReal.map((s) => outcomeFor(s.def.realId)).find((o) => o && !o.distribution_void) ??
    (stackReal.length ? outcomeFor(stackReal[0].def.realId) : null);

  const ageOptions = useMemo(
    () => Array.from(new Set([...AGE_PRESETS, patient.age])).sort((a, b) => a - b),
    [patient.age],
  );
  const weightPct = Math.min(100, Math.max(0, (patient.weightKg / 300) * 100));

  // Run the simulation over the user's STACK + the simulation controls.
  const handleRun = async () => {
    if (!stackReal.length) return;
    setLoading(true);
    try {
      // source for the run comes from the stack (per-compound "where it's from").
      const stackSource = stack.find((s) => s.source_type && s.source_type !== "label_dose")?.source_type;
      const data = await twinSimulate({
        user_ref: getUserRef(),
        patient: { age: patient.age, sex: patient.sex, weight_kg: patient.weightKg, conditions: patient.conditions },
        compounds: stackReal.map((s) => s.def.realId),
        tiers,
        source_type: stackSource || undefined,
        n_draws: nDraws,
      });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const showResult = loading || result !== null;

  return (
    <AppShell>
      <div className="flex flex-row w-full h-full overflow-hidden">
        {/* LEFT — inputs + simulation controls */}
        <div className="w-[340px] flex-shrink-0 border-r border-zinc-800/50 flex flex-col bg-[#121214] h-full overflow-y-auto">
          <div className="p-4 flex flex-col gap-4">
            {/* Base Demographic (editable, explicit Save) */}
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
                  className="w-full accent-cyan-500"
                  aria-label="Weight in kilograms"
                  style={{ background: `linear-gradient(to right, #22d3ee ${weightPct}%, #27272a ${weightPct}%)` }}
                />
              </div>

              <MultiSelectDropdown
                label="Goals"
                icon="lucide:target"
                options={GOAL_OPTIONS}
                selected={patient.goals ?? []}
                onChange={(next) => editProfile({ goals: next })}
                placeholder="Select your goals…"
              />
              <MultiSelectDropdown
                label="Conditions"
                icon="lucide:heart-pulse"
                options={CONDITION_OPTIONS}
                selected={patient.conditions ?? []}
                onChange={(next) => editProfile({ conditions: next })}
                placeholder="Select conditions…"
              />

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
                <Icon icon={saveState === "saving" ? "svg-spinners:180-ring" : saveState === "saved" ? "lucide:check" : "lucide:save"} className="w-4 h-4" />
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to profile" : saveState === "error" ? "Retry save" : "Save to profile"}
              </button>
            </div>

            {/* Compound (multi-select) + Run */}
            <div className="bg-[#121214]/50 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2.5 text-base font-medium text-zinc-100">
                <Icon icon="lucide:test-tube" className="w-5 h-5 text-zinc-400" />
                Compound
              </div>
              {DEMO_COMPOUNDS.map((c) => {
                const ex = compoundExtras[c.realId];
                const added = inStack(c.realId);
                const dose = draftDose[c.realId] ?? ex?.dose ?? "";
                const source = draftSource[c.realId] ?? "label_dose";
                return (
                  <div key={c.id} className={`rounded-xl border p-4 space-y-3 ${added ? "border-cyan-600/60 bg-cyan-950/10" : "border-zinc-700"}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] font-medium text-zinc-100">{c.name}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded tracking-wider uppercase ${c.tagClass}`}>{c.tag}</span>
                      {added && <span className="ml-auto text-[10px] text-cyan-300 flex items-center gap-1"><Icon icon="lucide:check" className="w-3 h-3" /> in stack</span>}
                    </div>
                    <div className="text-[13px] text-zinc-500">{c.desc}</div>

                    {ex?.vendors && ex.vendors.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Where to get it</div>
                        <div className="flex flex-wrap gap-1.5">
                          {ex.vendors.map((v) => (
                            <a key={v.name} href={v.url ?? "#"} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-950 text-cyan-300 hover:border-cyan-700 hover:bg-cyan-950/20 flex items-center gap-1">
                              <Icon icon="lucide:external-link" className="w-3 h-3" />
                              {v.name}
                              {v.costPerVial ? <span className="text-zinc-500">${v.costPerVial}</span> : null}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* dose + source inputs */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-zinc-500 mb-1 block">Dosage</label>
                        <input
                          value={dose}
                          onChange={(e) => setDraftDose((d) => ({ ...d, [c.realId]: e.target.value }))}
                          placeholder={ex?.dose ?? "e.g. 7.5mg"}
                          className="w-full bg-[#0a0a0a] border border-zinc-700/80 rounded-lg py-1.5 px-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 mb-1 block">Source</label>
                        <select
                          value={source}
                          onChange={(e) => setDraftSource((d) => ({ ...d, [c.realId]: e.target.value }))}
                          className="w-full bg-[#0a0a0a] border border-zinc-700/80 rounded-lg py-1.5 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                        >
                          {SOURCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAddToStack(c)}
                      className={`w-full rounded-lg px-3 py-2 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                        added ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700" : "bg-cyan-600 hover:bg-cyan-500 text-white"
                      }`}
                    >
                      <Icon icon={added ? "lucide:refresh-cw" : "lucide:plus"} className="w-4 h-4" />
                      {added ? "Update in Stack" : "Add to my Stack"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* CENTER — holographic twin + summary overlay / link-data gate */}
        <div className="flex-1 flex flex-row bg-[#0a0a0a] overflow-hidden h-full">
          <div className="flex-1 relative flex flex-col items-center justify-center h-full p-8 border-r border-zinc-800/50">
            <div className="absolute top-8 left-8 z-20">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 flex items-center gap-3">
                Digital Twin
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tracking-widest uppercase ${connected ? "border-cyan-900/50 text-cyan-400 bg-cyan-900/20" : "border-zinc-700 text-zinc-500 bg-zinc-800/50"}`}>
                  {connected ? "Live" : "No data"}
                </span>
              </h1>
              <p className="text-xs text-zinc-500 mt-1">
                {connected ? "Simulating physiology from your linked data." : "Link your data to bring the twin to life."}
              </p>
              {connected && (
                <div className="mt-3 text-xs text-zinc-400 font-mono">
                  {[`age ${patient.age}`, patient.sex === "M" ? "male" : "female", `${patient.weightKg} kg`].join(" · ")}
                </div>
              )}
            </div>

            {/* body — nudged right so it doesn't collide with the top-left summary */}
            <div className={`translate-x-20 ${connected ? "" : "opacity-40 grayscale transition-all"}`}>
              <BodyVisualization active={connected} />
            </div>

            {/* SUMMARY card — top-left (only once connected) */}
            {connected && (
              <div className="absolute top-28 left-6 z-20 w-56 rounded-2xl border border-cyan-900/30 bg-black/50 backdrop-blur-md p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">Summary</span>
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${og.border} ${og.bg} ${og.text}`}>{overallGrade}</span>
                  </div>
                  {BODY_SYSTEMS.map((sys) => {
                    const labs = labsForSystem(imp.labs, sys.key);
                    const grade = gradeFor(labs);
                    const gm = gradeMeta(grade);
                    return (
                      <div key={sys.key} className="flex items-center justify-between gap-1.5 text-xs">
                        <span className="text-zinc-300">{sys.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 rounded border ${gm.border} ${gm.bg} ${gm.text}`}>{grade}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Link Data gate — on top of the (greyed) twin until data is linked */}
            {!connected && (
              <div className="absolute inset-0 z-30 flex items-center justify-center">
                <div className="w-80 rounded-2xl border border-cyan-700/40 bg-[#0d0f12]/90 backdrop-blur-sm p-6 text-center shadow-2xl">
                  <Icon icon="lucide:link" className="text-cyan-400 text-2xl mb-3 mx-auto block" />
                  <h3 className="text-base font-semibold text-zinc-100">Link your data</h3>
                  <p className="text-xs text-zinc-500 mt-1.5 mb-4">
                    Connect a blood panel or wearable via Junction to activate your twin.
                  </p>
                  <button
                    type="button"
                    onClick={imp.pullBloodwork}
                    disabled={imp.bloodwork === "working"}
                    className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
                  >
                    <Icon icon={imp.bloodwork === "working" ? "svg-spinners:180-ring" : "lucide:test-tube"} />
                    {imp.bloodwork === "working" ? "Pulling your data…" : "Pull Blood Panel"}
                  </button>
                  <button
                    type="button"
                    onClick={imp.pullWearable}
                    disabled={imp.wearableState === "working"}
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 hover:border-cyan-700 px-4 py-2.5 text-sm font-medium text-zinc-200 flex items-center justify-center gap-2 transition-colors"
                  >
                    <Icon icon={imp.wearableState === "working" ? "svg-spinners:180-ring" : "lucide:watch"} className="text-cyan-400" />
                    {imp.wearableState === "working" ? "Pulling wearable…" : "Pull Wearable Data"}
                  </button>
                  {imp.error && <p className="mt-2 text-[10px] text-amber-400">{imp.error}</p>}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — link controls + health summary + (deferred) result */}
          <div className="w-[480px] flex-shrink-0 bg-[#121214] h-full overflow-y-auto flex flex-col">
            <div className="p-6 border-b border-zinc-800/50 bg-[#0a0a0a]">
              <div className="grid grid-cols-2 gap-3">
                <SourceCard
                  title="Pull Blood Panels"
                  subtitle="Junction lab results"
                  icon="lucide:test-tube"
                  connected={imp.bloodworkConnected}
                  working={imp.bloodwork === "working"}
                  onConnect={imp.pullBloodwork}
                  onDisconnect={imp.disconnectBloodwork}
                />
                <SourceCard
                  title="Pull Wearable Data"
                  subtitle="Oura / WHOOP via Junction"
                  icon="lucide:watch"
                  connected={imp.wearableConnected}
                  working={imp.wearableState === "working"}
                  onConnect={imp.pullWearable}
                  onDisconnect={imp.disconnectWearable}
                />
              </div>
              {imp.error && <p className="mt-3 text-[11px] text-amber-400">{imp.error}</p>}

              {/* Wearable metrics — shown once the wearable is connected */}
              {imp.wearableConnected && imp.wearableMetrics && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">Wearable</span>
                    {imp.wearableMocked && <span className="text-[9px] text-zinc-600">demo data</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <WearableStat icon="lucide:moon" label="Sleep" value={imp.wearableMetrics.sleep_hours != null ? `${imp.wearableMetrics.sleep_hours} h` : "—"} />
                    <WearableStat icon="lucide:footprints" label="Steps" value={imp.wearableMetrics.steps != null ? imp.wearableMetrics.steps.toLocaleString() : "—"} />
                    <WearableStat icon="lucide:heart" label="Resting HR" value={imp.wearableMetrics.resting_hr != null ? `${imp.wearableMetrics.resting_hr} bpm` : "—"} />
                    <WearableStat icon="lucide:activity" label="HRV" value={imp.wearableMetrics.hrv_ms != null ? `${imp.wearableMetrics.hrv_ms} ms` : "—"} />
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 flex-1 flex flex-col gap-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">Health Summary</h2>
                  <p className="text-xs text-zinc-400 mt-2 leading-relaxed max-w-[280px]">
                    {imp.bloodworkConnected
                      ? "Biomarkers pulled from your linked Junction lab panel."
                      : "Pull your blood panel to populate biomarkers + health score."}
                  </p>
                </div>
                {imp.bloodworkConnected && score != null && (
                  <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl border-2 flex-shrink-0 ${og.border} ${og.bg}`}>
                    <span className={`text-xl font-bold leading-none ${og.text}`}>{score}</span>
                    <span className="text-[8px] tracking-widest text-zinc-500 uppercase mt-0.5">Health</span>
                  </div>
                )}
              </div>

              {/* My Stack + Predict (right side) */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase mb-2">My Stack</div>
                {stackReal.length === 0 ? (
                  <p className="text-xs text-zinc-500">Add compounds (with dose + source) on the left to build your stack.</p>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {stackReal.map(({ item, def }) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-200 font-medium">{def.name}</span>
                        {item.dose && <span className="text-[11px] text-cyan-300">{item.dose}</span>}
                        {item.source_type && item.source_type !== "label_dose" && (
                          <span className="text-[10px] text-zinc-500">· {item.source_type.replace(/_/g, " ")}</span>
                        )}
                        <button type="button" onClick={() => removeFromStack(item.id)} className="ml-auto text-zinc-600 hover:text-rose-400">
                          <Icon icon="lucide:x" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={loading || stackReal.length === 0}
                  className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
                >
                  <Icon icon={loading ? "svg-spinners:180-ring" : "lucide:sparkles"} />
                  {loading ? "Predicting…" : `Predict my Result${stackReal.length > 1 ? ` (${stackReal.length})` : ""}`}
                </button>
              </div>

              {/* My Result — only after running */}
              {showResult && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">My Result</span>
                    {result && !loading && (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <Icon icon="lucide:check" className="w-3 h-3" /> simulation complete
                      </span>
                    )}
                  </div>
                  {stackReal.map(({ def }) => (
                    <ProjectedTrajectory
                      key={def.id}
                      outcome={outcomeFor(def.realId)}
                      loading={loading}
                      compoundName={def.name}
                      excludedReason={excludedFor(def.realId)}
                      baselineWeightKg={patient.weightKg}
                    />
                  ))}
                  <div className="flex gap-3">
                    <MetricChip icon="lucide:users" label="Cohort match" value={result ? (result.cohort_n === 0 ? "No match" : `${result.cohort_n}`) : "—"} />
                    <MetricChip icon="lucide:shield-check" label="Confidence" value={result?.data_confidence ?? "—"} />
                    <MetricChip icon="lucide:bar-chart-2" label="P(≥15% loss)" value={primaryOutcome?.prob_threshold != null ? `${Math.round(primaryOutcome.prob_threshold * 100)}%` : "—"} />
                  </div>
                </div>
              )}

              {/* Biomarkers — only once connected */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-zinc-500 mb-2 px-1 uppercase">
                  <span>Name</span>
                  <div className="flex gap-14 mr-4">
                    <span>Status</span>
                    <span>History</span>
                  </div>
                </div>
                {imp.bloodworkConnected && imp.labs.length > 0 ? (
                  <div className="space-y-1">
                    {imp.labs.map((lab) => (
                      <BiomarkerRow key={lab.name} lab={lab} />
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={imp.pullBloodwork}
                    className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-400 hover:border-cyan-700 hover:text-zinc-200 transition-colors"
                  >
                    <Icon icon="lucide:test-tube" className="text-cyan-400 text-lg mb-2 mx-auto block" />
                    Pull your blood panel to populate biomarkers
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
