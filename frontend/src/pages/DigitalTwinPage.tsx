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
const TIER_OPTIONS = [
  { key: "trial", label: "Trial" },
  { key: "quality", label: "Quality (source)" },
  { key: "anecdote", label: "Anecdote" },
  { key: "synthetic", label: "Synthetic (live)" },
];

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
          <div className="text-sm font-semibold text-emerald-400 mb-2">
            {outcome.p50 != null
              ? `${outcome.p50.toFixed(1)}${outcome.unit ?? "%"} median by month ${outcome.quarters.at(-1)?.month ?? 12}`
              : "Projection ready"}
          </div>
          <div className="flex items-end gap-1 h-14">
            {outcome.quarters.map((q) => {
              const maxAbs = Math.max(1, ...outcome.quarters.map((x) => Math.abs(x.p50)));
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

export default function DigitalTwinPage() {
  useDocumentTitle("PepHouse | Digital Twin");
  const imp = useImport();
  const connected = imp.connected;

  const [selectedCompounds, setSelectedCompounds] = useState<string[]>(["tirzepatide"]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Simulation controls (brought over from the Arena).
  const [tiers, setTiers] = useState<string[]>(["trial"]);
  const toggleTier = (k: string) => setTiers((ts) => (ts.includes(k) ? ts.filter((x) => x !== k) : [...ts, k]));
  const [sourceType, setSourceType] = useState("");
  const [nDraws, setNDraws] = useState(5000);

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

  const toggleCompound = (id: string) =>
    setSelectedCompounds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedReal = DEMO_COMPOUNDS.filter((c) => selectedCompounds.includes(c.id));
  const compoundExtras = useCompoundExtras(selectedReal.map((c) => c.realId));
  const overallGrade = useMemo(() => gradeFor(imp.labs), [imp.labs]);
  const og = gradeMeta(overallGrade);

  const outcomeFor = (realId: number) =>
    result?.outcomes.find((o) => o.compound_id === realId && o.outcome_name === "weight_change_pct") ?? null;
  const excludedFor = (realId: number) =>
    result?.excluded_priors?.find((e) => e.compound_id === realId)?.reason ?? null;
  const primaryOutcome =
    selectedReal.map((c) => outcomeFor(c.realId)).find((o) => o && !o.distribution_void) ??
    (selectedReal.length ? outcomeFor(selectedReal[0].realId) : null);

  const ageOptions = useMemo(
    () => Array.from(new Set([...AGE_PRESETS, patient.age])).sort((a, b) => a - b),
    [patient.age],
  );
  const weightPct = Math.min(100, Math.max(0, (patient.weightKg / 300) * 100));

  // Run the simulation through the backend /twin/simulate endpoint (full payload).
  const handleRun = async () => {
    if (!selectedReal.length) return;
    setLoading(true);
    try {
      const data = await twinSimulate({
        user_ref: getUserRef(),
        patient: { age: patient.age, sex: patient.sex, weight_kg: patient.weightKg, conditions: patient.conditions },
        compounds: selectedReal.map((c) => c.realId),
        tiers,
        source_type: tiers.includes("quality") ? sourceType || "gray_market" : undefined,
        n_draws: nDraws,
      });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // Link Data → pull the blood panel (reliable, populates biomarkers). Wearable
  // connect is a separate explicit action (it needs the Junction popup).
  const handleLinkData = () => imp.pullBloodwork();
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
                const sel = selectedCompounds.includes(c.id);
                const ex = compoundExtras[c.realId];
                return (
                  <div
                    key={c.id}
                    className={`rounded-xl transition-colors relative ${
                      sel ? "border border-cyan-500 ring-1 ring-cyan-500" : "border border-zinc-700 hover:bg-zinc-800/30"
                    }`}
                  >
                    <button type="button" onClick={() => toggleCompound(c.id)} aria-pressed={sel} className="w-full p-4 flex flex-col text-left">
                      <span className={`absolute top-3 right-3 w-4 h-4 rounded border flex items-center justify-center ${sel ? "bg-cyan-500 border-cyan-500" : "border-zinc-600"}`}>
                        {sel && <Icon icon="lucide:check" className="w-3 h-3 text-white" />}
                      </span>
                      <div className="flex items-center gap-3 mb-1 pr-6">
                        <span className="text-[15px] font-medium text-zinc-100">{c.name}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded tracking-wider uppercase ${c.tagClass}`}>{c.tag}</span>
                      </div>
                      <div className="text-[13px] text-zinc-500">{c.desc}</div>
                    </button>
                    {sel && (
                      <div className="px-4 pb-4 -mt-1 space-y-2">
                        <div className="text-[12px] text-zinc-400 flex items-center gap-1.5">
                          <Icon icon="lucide:pill" className="w-3.5 h-3.5 text-cyan-400" />
                          Typical dose: <span className="text-zinc-200">{ex?.dose ?? "—"}</span>
                        </div>
                        {ex?.vendors && ex.vendors.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Where to get it</div>
                            <div className="flex flex-wrap gap-1.5">
                              {ex.vendors.map((v) => (
                                <a
                                  key={v.name}
                                  href={v.url ?? "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-950 text-cyan-300 hover:border-cyan-700 hover:bg-cyan-950/20 flex items-center gap-1"
                                >
                                  <Icon icon="lucide:external-link" className="w-3 h-3" />
                                  {v.name}
                                  {v.costPerVial ? <span className="text-zinc-500">${v.costPerVial}</span> : null}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={handleRun}
                disabled={loading || selectedReal.length === 0}
                className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
              >
                <Icon icon={loading ? "svg-spinners:180-ring" : "lucide:play"} />
                {loading ? "Simulating…" : `Simulate My Results${selectedReal.length > 1 ? ` (${selectedReal.length})` : ""}`}
              </button>
            </div>

            {/* Simulation controls (from the Arena) */}
            <div className="bg-[#121214]/50 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <Icon icon="lucide:sliders-horizontal" /> Simulation Controls
              </h3>
              <div>
                <label className="text-[12px] text-zinc-500">Data tiers (what feeds the twin)</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TIER_OPTIONS.map((t) => {
                    const on = tiers.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleTier(t.key)}
                        aria-pressed={on}
                        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${on ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-200" : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">Anecdote widens the band + lowers confidence. Synthetic = live Synthea cohort (~7s).</p>
              </div>
              <div>
                <label className="text-[12px] text-zinc-500">Source (where you bought it)</label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
                >
                  <option value="">Label dose (no source modeling)</option>
                  <option value="compounding_pharmacy">Compounding pharmacy (clean)</option>
                  <option value="vendor_tested">Gray-market, lab-tested</option>
                  <option value="gray_market">Gray-market, untested (China)</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] text-zinc-500">Monte Carlo draws (statistical samples, not patients)</label>
                <select
                  value={nDraws}
                  onChange={(e) => setNDraws(Number(e.target.value))}
                  className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
                >
                  <option value={1000}>1,000 runs (fast)</option>
                  <option value={5000}>5,000 runs (default)</option>
                  <option value={20000}>20,000 runs (smooth tails)</option>
                </select>
              </div>
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

            {/* Semi-transparent SUMMARY overlay on the twin (only once connected) */}
            {connected && (
              <div className="absolute top-8 right-8 z-20 w-56 rounded-2xl border border-cyan-900/30 bg-black/40 backdrop-blur-md p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold tracking-widest text-zinc-400 uppercase">Summary</span>
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${og.border} ${og.bg} ${og.text}`}>{overallGrade}</span>
                </div>
                <div className="space-y-1.5">
                  {BODY_SYSTEMS.map((sys) => {
                    const labs = labsForSystem(imp.labs, sys.key);
                    const grade = gradeFor(labs);
                    const gm = gradeMeta(grade);
                    return (
                      <div key={sys.key} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300">{sys.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 rounded border ${gm.border} ${gm.bg} ${gm.text}`}>{grade}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={connected ? "" : "opacity-40 grayscale transition-all"}>
              <BodyVisualization active={connected} />
            </div>

            {/* Link Data gate — on top of the (greyed) twin until data is linked */}
            {!connected && (
              <div className="absolute inset-0 z-30 flex items-center justify-center">
                <div className="w-80 rounded-2xl border border-cyan-700/40 bg-[#0d0f12]/90 backdrop-blur-sm p-6 text-center shadow-2xl">
                  <Icon icon="lucide:link" className="text-cyan-400 text-2xl mb-3 mx-auto block" />
                  <h3 className="text-base font-semibold text-zinc-100">Link your data</h3>
                  <p className="text-xs text-zinc-500 mt-1.5 mb-4">
                    Connect a blood panel via Junction to activate your twin and populate your summary.
                  </p>
                  <button
                    type="button"
                    onClick={handleLinkData}
                    disabled={imp.bloodwork === "working"}
                    className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 px-4 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
                  >
                    <Icon icon={imp.bloodwork === "working" ? "svg-spinners:180-ring" : "lucide:test-tube"} />
                    {imp.bloodwork === "working" ? "Pulling your data…" : "Pull blood panel"}
                  </button>
                  <button
                    type="button"
                    onClick={imp.connectDevice}
                    className="mt-2 text-[11px] text-zinc-500 hover:text-cyan-300"
                  >
                    or connect a wearable (Oura / WHOOP)
                  </button>
                  {imp.error && imp.device === "error" && (
                    <p className="mt-2 text-[10px] text-amber-400">{imp.error}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — link controls + health summary + (deferred) result */}
          <div className="w-[480px] flex-shrink-0 bg-[#121214] h-full overflow-y-auto flex flex-col">
            <div className="p-6 border-b border-zinc-800/50 bg-[#0a0a0a]">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleLinkData}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 text-xs p-3 rounded-xl flex flex-col gap-2 transition-colors text-left group"
                >
                  <div className="flex justify-between items-center w-full">
                    <Icon icon={imp.bloodwork === "working" ? "svg-spinners:180-ring" : "lucide:link"} className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" />
                    <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-600"}`} />
                  </div>
                  <div>
                    <div className="text-zinc-200 font-semibold mb-0.5">Link Data</div>
                    <div className="text-[10px] text-zinc-500">Oura, Labs via Junction</div>
                  </div>
                </button>
                <button type="button" className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/50 text-xs p-3 rounded-xl flex flex-col gap-2 transition-colors text-left group">
                  <div className="flex justify-between items-center w-full">
                    <Icon icon="lucide:target" className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" />
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                  </div>
                  <div>
                    <div className="text-zinc-200 font-semibold mb-0.5">Goals &amp; Stack</div>
                    <div className="text-[10px] text-zinc-500">Define target states</div>
                  </div>
                </button>
              </div>
              {connected && (imp.deviceLabel || imp.bloodworkLabel) && (
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
                    {connected
                      ? "Biomarkers pulled from your linked Junction lab panel."
                      : "Link your data to populate your health summary."}
                  </p>
                </div>
                {connected && (
                  <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${og.border} ${og.bg}`}>
                    <span className={`text-lg font-bold ${og.text}`}>{overallGrade}</span>
                  </div>
                )}
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
                  {selectedReal.map((c) => (
                    <ProjectedTrajectory
                      key={c.id}
                      outcome={outcomeFor(c.realId)}
                      loading={loading}
                      compoundName={c.name}
                      excludedReason={excludedFor(c.realId)}
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
                {connected && imp.labs.length > 0 ? (
                  <div className="space-y-1">
                    {imp.labs.map((lab) => (
                      <BiomarkerRow key={lab.name} lab={lab} />
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleLinkData}
                    className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-400 hover:border-cyan-700 hover:text-zinc-200 transition-colors"
                  >
                    <Icon icon="lucide:test-tube" className="text-cyan-400 text-lg mb-2 mx-auto block" />
                    Link your data to populate biomarkers
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
