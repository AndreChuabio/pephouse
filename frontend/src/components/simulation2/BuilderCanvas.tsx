import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import {
  PENALTIES,
  SEVERITY_PENALTY,
  sourceTier,
  studyKey,
  type ChainNode,
  type ChainNodeType,
  type CompoundProfile,
  type InteractionSeverityKey,
  type Sex,
  type SimulationSnapshot,
  type StudyRef,
} from "../../data/simulation2";
import type { InteractionPair, SyntheaModuleRow } from "../../lib/api";
import { cn } from "../../lib/cn";
import { InteractionsBody } from "./InteractionsBody";
import { ModuleGraph, ModuleStateInspector } from "./ModuleGraph";
import { TierBadge } from "./Sim2Primitives";

const COMPOUND_HUES = [
  "ring-blue-500/40 border-blue-500/30 bg-blue-500/5 text-blue-300",
  "ring-purple-500/40 border-purple-500/30 bg-purple-500/5 text-purple-300",
  "ring-amber-500/40 border-amber-500/30 bg-amber-500/5 text-amber-300",
  "ring-emerald-500/40 border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
];

function compoundAccent(index: number) {
  return COMPOUND_HUES[index % COMPOUND_HUES.length];
}

type ChipTone = "positive" | "negative" | "neutral";

type Contribution = {
  value: number;
  tone: ChipTone;
  suffix?: string;
};

function chipClasses(tone: ChipTone) {
  if (tone === "positive") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (tone === "negative") return "bg-amber-500/10 text-amber-500 border-amber-500/20";
  return "bg-zinc-800/60 text-zinc-400 border-zinc-700/60";
}

function ContributionChip({ contribution }: { contribution: Contribution }) {
  const sign = contribution.value > 0 ? "+" : contribution.value < 0 ? "" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium font-mono px-1.5 py-0.5 rounded-sm border whitespace-nowrap",
        chipClasses(contribution.tone),
      )}
    >
      {sign}
      {contribution.value}
      {contribution.suffix ? <span className="ml-0.5 opacity-70 whitespace-nowrap">{contribution.suffix}</span> : null}
    </span>
  );
}

type BuilderCanvasProps = {
  nodes: ChainNode[];
  onAddNode: (type: ChainNodeType, compoundId?: string) => void;
  onRemoveNode: (id: string) => void;
  onMoveNode: (id: string, direction: -1 | 1) => void;
  onRun: () => void;
  compounds: CompoundProfile[];
  compoundList: CompoundProfile[];
  primaryCompound: CompoundProfile;
  compoundIds: string[];
  onToggleCompound: (id: string) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  sex: Sex;
  onSexChange: (sex: Sex) => void;
  age: number;
  onAgeChange: (age: number) => void;
  weight: number;
  onWeightChange: (weight: number) => void;
  dose: number;
  onDoseChange: (dose: number) => void;
  snapshot: SimulationSnapshot;
  excludedStudies: Record<string, boolean>;
  onToggleStudy: (compoundId: string, tier: 1 | 2 | 3 | 4, title: string) => void;
  sourceFractions: Record<string, number>;
  studiesByCompoundTier: Record<string, StudyRef[]>;
  studiesLoadingByCompound: Record<string, boolean>;
  modulesByCompound: Record<string, SyntheaModuleRow[]>;
  interactionPairs: InteractionPair[];
  interactionsLoading: boolean;
  interactionsError: string | null;
  excludedInteractions: Record<string, boolean>;
  onToggleInteraction: (pairKey: string) => void;
};

function nodeContribution(
  node: ChainNode,
  compound: CompoundProfile,
  snapshot: SimulationSnapshot,
  isPrimary: boolean,
  fraction: number,
): Contribution | null {
  const pct = Math.round(fraction * 100);
  switch (node.type) {
    case "compound":
      return { value: compound.baseProfileScore, tone: "positive", suffix: "base" };
    case "demographics":
      if (snapshot.ageExtrapolated)
        return { value: -PENALTIES.ageExtrapolated, tone: "negative", suffix: "age" };
      if (snapshot.outsideStudiedRange)
        return { value: -PENALTIES.outsideStudiedRange, tone: "negative", suffix: "age" };
      return { value: 0, tone: "neutral", suffix: "in cohort" };
    case "run":
      return { value: snapshot.confidenceScore, tone: "positive", suffix: "%" };
    case "source-tier-4": {
      if (!isPrimary) return { value: pct, tone: "neutral", suffix: "%" };
      const held = Math.round(PENALTIES.tier4Excluded * fraction);
      return { value: held, tone: fraction > 0 ? "positive" : "negative", suffix: "held" };
    }
    case "source-tier-2": {
      if (!isPrimary) return { value: pct, tone: "neutral", suffix: "%" };
      const held = Math.round(PENALTIES.tier2Off * fraction);
      return { value: held, tone: fraction > 0 ? "positive" : "negative", suffix: "held" };
    }
    case "source-tier-1": {
      if (isPrimary && compound.id === "bpc-157") {
        const held = Math.round(PENALTIES.tier1OffBpc * fraction);
        return { value: held, tone: fraction > 0 ? "positive" : "negative", suffix: "held" };
      }
      return { value: pct, tone: "neutral", suffix: "%" };
    }
    case "source-tier-3":
      return { value: pct, tone: "neutral", suffix: "%" };
    default:
      return null;
  }
}

type NodeShellProps = {
  title: string;
  subtitle?: React.ReactNode;
  icon: string;
  badge?: React.ReactNode;
  active?: boolean;
  warn?: boolean;
  accentClass?: string;
  canRemove?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  showInputPort?: boolean;
  showOutputPort?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  summary?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

function PortDot({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-[24px] -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-zinc-700 bg-[#0A0A0A]",
        side === "left" ? "-left-[5px]" : "-right-[5px]",
      )}
    />
  );
}

function NodeShell({
  title,
  subtitle,
  icon,
  badge,
  active = true,
  warn = false,
  accentClass,
  canRemove = false,
  canMoveUp = false,
  canMoveDown = false,
  onRemove,
  onMoveUp,
  onMoveDown,
  showInputPort = true,
  showOutputPort = true,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  summary,
  children,
  footer,
}: NodeShellProps) {
  const hasControls = canRemove || canMoveUp || canMoveDown;
  const showBody = !collapsible || !collapsed;
  return (
    <div
      className={cn(
        "group w-72 bg-[#121212] border border-zinc-800 rounded-xl relative sim2-node-connector shrink-0",
        active && "sim2-node-connector-active",
        warn && "border-amber-500/30 ring-1 ring-amber-500/10",
        accentClass,
      )}
    >
      {showInputPort && <PortDot side="left" />}
      {showOutputPort && <PortDot side="right" />}
      <div className="border-b border-zinc-800/50">
        <div className="px-4 pt-3 pb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-5 h-5 rounded border border-zinc-800 flex items-center justify-center bg-zinc-900 shrink-0">
              <Icon icon={icon} className="text-zinc-400 text-xs" />
            </div>
            <h2 className="text-sm font-medium tracking-tight text-zinc-100 leading-tight line-clamp-2">{title}</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {collapsible && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="w-5 h-5 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-200"
                title={collapsed ? "Expand" : "Collapse"}
              >
                <Icon
                  icon={collapsed ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-up-linear"}
                  className="text-xs"
                />
              </button>
            )}
            {hasControls && (
              <div className="flex items-center gap-0.5 invisible group-hover:visible">
                {canMoveUp && (
                  <button
                    type="button"
                    onClick={onMoveUp}
                    className="w-5 h-5 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-200"
                    title="Move earlier in chain"
                  >
                    <Icon icon="solar:alt-arrow-left-linear" className="text-xs" />
                  </button>
                )}
                {canMoveDown && (
                  <button
                    type="button"
                    onClick={onMoveDown}
                    className="w-5 h-5 rounded hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-200"
                    title="Move later in chain"
                  >
                    <Icon icon="solar:alt-arrow-right-linear" className="text-xs" />
                  </button>
                )}
                {canRemove && (
                  <button
                    type="button"
                    onClick={onRemove}
                    className="w-5 h-5 rounded hover:bg-red-500/20 hover:text-red-400 flex items-center justify-center text-zinc-500"
                    title="Remove node"
                  >
                    <Icon icon="solar:close-circle-linear" className="text-xs" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {(subtitle || badge) && (
          <div className="pl-11 pr-4 pb-3 pt-0 flex items-center justify-between gap-2">
            <div className="min-w-0 text-[10px] text-zinc-500 truncate">{subtitle}</div>
            <div className="flex items-center gap-1.5 shrink-0">{badge}</div>
          </div>
        )}
      </div>
      {showBody ? <div className="p-4">{children}</div> : summary ? (
        <div className="px-4 py-2.5 text-[11px] text-zinc-500">{summary}</div>
      ) : null}
      {showBody && footer}
    </div>
  );
}

type CompoundBodyProps = {
  compoundIds: string[];
  compoundList: CompoundProfile[];
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onToggleCompound: (id: string) => void;
  compoundIndexById: Record<string, number>;
};

function CompoundBody({
  compoundIds,
  compoundList,
  searchQuery,
  onSearchQueryChange,
  onToggleCompound,
  compoundIndexById,
}: CompoundBodyProps) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon
          icon="solar:magnifer-linear"
          className="absolute left-2.5 top-2 text-zinc-500 text-sm"
        />
        <input
          type="text"
          placeholder="Search molecule..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 bg-[#0A0A0A] border border-zinc-800 rounded-md text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 focus:bg-[#121212] transition-colors placeholder-zinc-600"
        />
      </div>
      {compoundIds.length === 0 && (
        <div className="text-[11px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded-md px-2.5 py-2">
          No compound selected — chain has no subject. Pick one below.
        </div>
      )}
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 pb-0.5">
        {compoundIds.length} in scope · click to add or remove
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
        {compoundList.map((c) => {
          const selected = compoundIds.includes(c.id);
          const index = compoundIndexById[c.id] ?? 0;
          const accentText = compoundAccent(index).split(" ")[3];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggleCompound(c.id)}
              className={cn(
                "w-full text-left px-2.5 py-1.5 rounded-md border transition-colors flex items-start gap-2",
                selected
                  ? "bg-zinc-800/70 border-zinc-700"
                  : "border-transparent hover:bg-zinc-900/70 hover:border-zinc-800",
              )}
              title={selected ? "Click to remove from chain" : "Click to add to chain"}
            >
              <span
                className={cn(
                  "mt-[3px] w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors",
                  selected
                    ? "border-emerald-500/60 bg-emerald-500/20"
                    : "border-zinc-700 bg-transparent",
                )}
                aria-hidden
              >
                {selected && (
                  <Icon icon="solar:check-read-linear" className="text-emerald-300 text-[10px]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("text-xs font-medium block", selected ? accentText : "text-zinc-300")}>
                  {c.name}
                </span>
                <span className="text-[11px] text-zinc-500 block leading-tight mt-0.5">
                  {c.subtitle}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SourceBodyProps = {
  tier: 1 | 2 | 3 | 4;
  compound: CompoundProfile;
  studies: StudyRef[];
  studiesLoading?: boolean;
  excludedStudies: Record<string, boolean>;
  onToggleStudy: (compoundId: string, tier: 1 | 2 | 3 | 4, title: string) => void;
  modules: SyntheaModuleRow[];
};

function SourceBody({
  tier,
  compound,
  studies,
  studiesLoading,
  excludedStudies,
  modules,
  onToggleStudy,
}: SourceBodyProps) {
  const source = compound.evidenceSources.find((s) => s.tier === tier);
  const includedCount = studies.filter(
    (s) => !excludedStudies[studyKey(compound.id, tier, s.title)],
  ).length;
  return (
    <div className="space-y-3">
      {source?.summary && (
        <p className="text-[11px] text-zinc-500 leading-snug">{source.summary}</p>
      )}
      {studies.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-zinc-800/40">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">
              {includedCount} of {studies.length} included
            </div>
          </div>
          <ul className="space-y-1">
            {studies.map((s) => {
              const key = studyKey(compound.id, tier, s.title);
              const excluded = !!excludedStudies[key];
              return (
                <li key={s.title} className="flex items-start gap-2 text-[11px] group/study">
                  <button
                    type="button"
                    onClick={() => onToggleStudy(compound.id, tier, s.title)}
                    className={cn(
                      "mt-[2px] w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors",
                      excluded
                        ? "border-zinc-700 bg-transparent hover:border-zinc-500"
                        : "border-emerald-500/60 bg-emerald-500/20 hover:bg-emerald-500/30",
                    )}
                    title={excluded ? "Include study" : "Exclude study"}
                    aria-pressed={!excluded}
                  >
                    {!excluded && (
                      <Icon icon="solar:check-read-linear" className="text-emerald-300 text-[10px]" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cn("leading-snug", excluded ? "text-zinc-600 line-through" : "text-zinc-300")}>
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-blue-400 inline-flex items-center gap-1"
                        >
                          {s.title}
                          <Icon icon="solar:arrow-right-up-linear" className="text-[9px] opacity-70" />
                        </a>
                      ) : (
                        s.title
                      )}
                    </div>
                    {s.meta && (
                      <div className={cn("text-[10px] font-mono", excluded ? "text-zinc-700" : "text-zinc-500")}>
                        {s.meta}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {studies.length === 0 && (
        <p className="text-[11px] text-zinc-600 italic pt-1">
          {studiesLoading ? "Loading studies…" : "No registry rows for this tier yet."}
        </p>
      )}
      {(() => {
        const relevant = modules.filter((m) => {
          const isAnecdotal = (m.name ?? "").toLowerCase().includes("anecdotal");
          if (tier === 1) return isAnecdotal;
          if (tier === 4) return !isAnecdotal;
          return false;
        });
        if (relevant.length === 0) return null;
        return (
          <details className="pt-2 border-t border-zinc-800/40">
            <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200 select-none">
              Synthea modules ({relevant.length})
            </summary>
            <div className="mt-2 space-y-3">
              {relevant.map((m) => (
                <div
                  key={m.id}
                  className="bg-[#0a0a0a] border border-zinc-800/60 rounded-md p-2 space-y-2"
                >
                  <div className="text-[10px] text-zinc-400">
                    <code className="text-zinc-200">{m.outcome_name}</code>
                    <span className="text-zinc-600"> · module #{m.id}</span>
                  </div>
                  <ModuleGraph states={m.module.states} />
                  <details>
                    <summary className="cursor-pointer text-[9px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200 select-none">
                      State inspector
                    </summary>
                    <div className="mt-1.5">
                      <ModuleStateInspector states={m.module.states} />
                    </div>
                  </details>
                  {m.module.remarks && m.module.remarks.length > 0 && (
                    <ul className="text-[9px] text-zinc-500 pl-3 list-disc space-y-0.5">
                      {m.module.remarks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </details>
        );
      })()}
    </div>
  );
}

type DemographicsBodyProps = {
  sex: Sex;
  onSexChange: (s: Sex) => void;
  age: number;
  onAgeChange: (a: number) => void;
  weight: number;
  onWeightChange: (w: number) => void;
  dose: number;
  onDoseChange: (d: number) => void;
  snapshot: SimulationSnapshot;
  compound: CompoundProfile;
};

function DemographicsBody({
  sex,
  onSexChange,
  age,
  onAgeChange,
  weight,
  onWeightChange,
  dose,
  onDoseChange,
  snapshot,
  compound,
}: DemographicsBodyProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-zinc-400">Age</span>
          <span className={cn("font-medium", snapshot.ageExtrapolated ? "text-amber-500" : "text-zinc-200")}>
            {age} yrs
          </span>
        </div>
        <input
          type="range"
          min={18}
          max={90}
          value={age}
          onChange={(e) => onAgeChange(Number(e.target.value))}
          className="sim2-range w-full"
        />
        <div className="relative flex justify-between text-[10px] text-zinc-500 mt-1 px-1">
          <span>18</span>
          <div
            className="absolute h-1 bg-emerald-500/20 -top-2.5 rounded-full z-0"
            style={{
              left: `${((compound.primaryCohortMin - 18) / 72) * 100}%`,
              right: `${100 - ((compound.primaryCohortMax - 18) / 72) * 100}%`,
            }}
            title={`Primary study cohort (${compound.primaryCohortMin}–${compound.primaryCohortMax})`}
          />
          <span>90</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {(["M", "F"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSexChange(s)}
            className={cn(
              "flex-1 py-1.5 border rounded-md text-xs font-medium transition-colors",
              sex === s
                ? "border-zinc-700 text-zinc-100 bg-zinc-800"
                : "border-transparent text-zinc-400 hover:bg-zinc-800/50",
            )}
          >
            {s === "M" ? "Male" : "Female"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-zinc-400">Weight</span>
          <span className="text-zinc-200 font-medium">{weight} kg</span>
        </div>
        <input
          type="range"
          min={50}
          max={180}
          value={weight}
          onChange={(e) => onWeightChange(Number(e.target.value))}
          className="sim2-range w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-zinc-400">Daily Dose (mcg)</label>
        <div className="flex items-center border border-zinc-800 rounded-md overflow-hidden focus-within:border-zinc-600 transition-colors bg-[#0A0A0A]">
          <input
            type="number"
            value={dose}
            onChange={(e) => onDoseChange(Number(e.target.value))}
            className="w-full px-3 py-1.5 text-xs text-zinc-100 bg-transparent focus:outline-none"
          />
          <span className="text-[10px] text-zinc-500 pr-3">mcg</span>
        </div>
      </div>
    </div>
  );
}

function RunBody({ onRun, snapshot }: { onRun: () => void; snapshot: SimulationSnapshot }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">Confidence (live)</span>
        <span
          className={cn(
            "font-medium",
            snapshot.confidenceLevel === "High"
              ? "text-emerald-400"
              : snapshot.confidenceLevel === "Moderate"
                ? "text-amber-500"
                : "text-red-400",
          )}
        >
          {snapshot.confidenceScore}%
        </span>
      </div>
      <button
        type="button"
        onClick={onRun}
        className="w-full bg-zinc-100 text-zinc-900 hover:bg-white transition-colors px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-2"
      >
        <Icon icon="solar:play-linear" className="text-sm" />
        Run Execution
      </button>
      <p className="text-[11px] text-zinc-500 leading-snug">
        Terminal node — chain executes into this report.
      </p>
    </div>
  );
}

type PaletteOption = { key: string; type: ChainNodeType; compoundId?: string; label: string; group?: string };

type PaletteButtonProps = {
  options: PaletteOption[];
  onAddNode: (type: ChainNodeType, compoundId?: string) => void;
};

function PaletteButton({ options, onAddNode }: PaletteButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const disabled = options.length === 0;
  const grouped = useMemo(() => {
    const map = new Map<string, PaletteOption[]>();
    for (const opt of options) {
      const k = opt.group ?? "Add to chain";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(opt);
    }
    return Array.from(map.entries());
  }, [options]);

  return (
    <div ref={wrapRef} className="relative shrink-0 self-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "w-12 h-12 rounded-full border border-dashed flex items-center justify-center transition-colors",
          disabled
            ? "border-zinc-800 text-zinc-700 cursor-not-allowed"
            : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100 bg-[#0A0A0A]",
        )}
        title={disabled ? "No additional nodes available" : "Add node"}
      >
        <Icon icon="solar:add-circle-linear" className="text-xl" />
      </button>
      {open && options.length > 0 && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-64 bg-[#121212] border border-zinc-800 rounded-lg shadow-xl z-20 overflow-hidden max-h-96 overflow-y-auto">
          {grouped.map(([group, opts]) => (
            <div key={group}>
              <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800 bg-zinc-950/60">
                {group}
              </div>
              <ul>
                {opts.map((opt) => (
                  <li key={opt.key}>
                    <button
                      type="button"
                      onClick={() => {
                        onAddNode(opt.type, opt.compoundId);
                        setOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800/60 flex items-center gap-2"
                    >
                      <Icon icon="solar:add-square-linear" className="text-zinc-500" />
                      {opt.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BuilderCanvas({
  nodes,
  onAddNode,
  onRemoveNode,
  onMoveNode,
  onRun,
  compounds,
  compoundList,
  primaryCompound,
  compoundIds,
  onToggleCompound,
  searchQuery,
  onSearchQueryChange,
  sex,
  onSexChange,
  age,
  onAgeChange,
  weight,
  onWeightChange,
  dose,
  onDoseChange,
  snapshot,
  excludedStudies,
  onToggleStudy,
  sourceFractions,
  studiesByCompoundTier,
  studiesLoadingByCompound,
  modulesByCompound,
  interactionPairs,
  interactionsLoading,
  interactionsError,
  excludedInteractions,
  onToggleInteraction,
}: BuilderCanvasProps) {
  const runIdx = nodes.findIndex((n) => n.type === "run");
  const lastMovableIdx = runIdx === -1 ? nodes.length - 1 : runIdx - 1;
  const compoundById = useMemo(() => {
    const map: Record<string, CompoundProfile> = {};
    for (const c of compounds) map[c.id] = c;
    return map;
  }, [compounds]);
  const compoundIndexById = useMemo(() => {
    const map: Record<string, number> = {};
    compoundIds.forEach((id, i) => (map[id] = i));
    return map;
  }, [compoundIds]);

  const paletteOptions = useMemo<PaletteOption[]>(() => {
    const present = new Set(nodes.map((n) => n.id));
    const opts: PaletteOption[] = [];
    for (const c of compounds) {
      for (const tier of [4, 3, 2, 1] as const) {
        const type = `source-tier-${tier}` as ChainNodeType;
        const id = `${type}-${c.id}`;
        if (present.has(id)) continue;
        const studies = studiesByCompoundTier[`${c.id}::tier-${tier}`];
        if (!studies || studies.length === 0) continue;
        const sourceLabel = c.evidenceSources.find((s) => s.tier === tier)?.label ?? `Tier ${tier}`;
        opts.push({
          key: id,
          type,
          compoundId: c.id,
          label: `Tier ${tier} · ${sourceLabel}`,
          group: c.name,
        });
      }
    }
    if (!nodes.some((n) => n.type === "demographics")) {
      opts.push({ key: "demographics", type: "demographics", label: "Demographics", group: "Chain" });
    }
    if (!nodes.some((n) => n.type === "run")) {
      opts.push({ key: "run", type: "run", label: "Run (terminal)", group: "Chain" });
    }
    return opts;
  }, [nodes, compounds, studiesByCompoundTier]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));

  const demoSummary = `${sex === "M" ? "Male" : "Female"} · ${age} yrs · ${weight} kg · ${dose} mcg`;

  return (
    <div className="flex-1 overflow-x-auto relative pl-12 pr-24 py-12 flex items-center h-full min-h-0">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(#27272A 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="flex items-start gap-16 relative z-10 mx-auto min-w-max">
        {nodes.map((node, i) => {
          const isRun = node.type === "run";
          const canRemove = true;
          const canMoveUp = !isRun && i > 0;
          const canMoveDown = !isRun && i < lastMovableIdx;
          const showInputPort = i > 0;
          const showOutputPort = i < nodes.length - 1;

          const nodeCompound = node.compoundId
            ? compoundById[node.compoundId] ?? primaryCompound
            : primaryCompound;
          const compoundIndex = node.compoundId ? compoundIndexById[node.compoundId] ?? 0 : 0;
          const isPrimary = nodeCompound.id === primaryCompound.id;

          const nodeTier = sourceTier(node.type);
          const fraction = nodeTier && isPrimary ? sourceFractions[`tier${nodeTier}`] ?? 0 : 1;
          const contribution = nodeContribution(node, nodeCompound, snapshot, isPrimary, fraction);
          const badge = contribution ? <ContributionChip contribution={contribution} /> : undefined;

          const shared = {
            canRemove,
            canMoveUp,
            canMoveDown,
            onRemove: () => onRemoveNode(node.id),
            onMoveUp: () => onMoveNode(node.id, -1),
            onMoveDown: () => onMoveNode(node.id, 1),
            showInputPort,
            showOutputPort,
            badge,
          };

          if (node.type === "compound") {
            const compoundSummary =
              compoundIds.length === 0
                ? "none selected"
                : compoundIds.length === 1
                  ? compounds[0]?.name ?? compoundIds[0]
                  : `${compounds[0]?.name ?? compoundIds[0]} +${compoundIds.length - 1} stack`;
            return (
              <NodeShell
                key={node.id}
                title="Compounds"
                subtitle={`${compoundIds.length} in scope`}
                icon="solar:test-tube-linear"
                collapsible
                collapsed={collapsed[node.id] ?? false}
                onToggleCollapse={() => toggleCollapsed(node.id)}
                summary={compoundSummary}
                {...shared}
                canRemove={false}
                canMoveUp={false}
                canMoveDown={false}
              >
                <CompoundBody
                  compoundIds={compoundIds}
                  compoundList={compoundList}
                  searchQuery={searchQuery}
                  onSearchQueryChange={onSearchQueryChange}
                  onToggleCompound={onToggleCompound}
                  compoundIndexById={compoundIndexById}
                />
              </NodeShell>
            );
          }

          if (node.type === "interactions") {
            const activePairs = interactionPairs.filter((p) => {
              const lo = Math.min(p.compound_a_id, p.compound_b_id);
              const hi = Math.max(p.compound_a_id, p.compound_b_id);
              return !excludedInteractions[`${lo}::${hi}::${p.source_kind}`];
            });
            const totalPenalty = activePairs.reduce(
              (acc, p) => acc + (SEVERITY_PENALTY[p.severity as InteractionSeverityKey] ?? 0),
              0,
            );
            const worst: InteractionSeverityKey | null = activePairs.some((p) => p.severity === "major")
              ? "major"
              : activePairs.some((p) => p.severity === "moderate")
                ? "moderate"
                : activePairs.some((p) => p.severity === "minor")
                  ? "minor"
                  : activePairs.some((p) => p.severity === "unknown")
                    ? "unknown"
                    : null;
            const interactionBadge = activePairs.length > 0 ? (
              <ContributionChip
                contribution={{
                  value: -totalPenalty,
                  tone: worst === "major" ? "negative" : worst === "moderate" ? "negative" : "neutral",
                  suffix: "risk",
                }}
              />
            ) : undefined;
            const subtitle = (
              <span className="text-zinc-500">
                {interactionPairs.length} pair{interactionPairs.length === 1 ? "" : "s"}
                {worst && ` · worst: ${worst}`}
              </span>
            );
            return (
              <NodeShell
                key={node.id}
                title="Drug Interactions"
                subtitle={subtitle}
                icon="solar:shield-warning-linear"
                warn={worst === "major"}
                {...shared}
                canRemove={false}
                canMoveUp={false}
                canMoveDown={false}
                badge={interactionBadge}
              >
                <InteractionsBody
                  pairs={interactionPairs}
                  loading={interactionsLoading}
                  error={interactionsError}
                  excluded={excludedInteractions}
                  onTogglePair={onToggleInteraction}
                />
              </NodeShell>
            );
          }

          const tier = sourceTier(node.type);
          if (tier) {
            const tier4Warn = tier === 4 && snapshot.tier4Excluded === false && snapshot.degraded;
            const accent = compoundAccent(compoundIndex);
            const source = nodeCompound.evidenceSources.find((s) => s.tier === tier);
            const sourceTitle = source?.label ?? `Tier ${tier} Source`;
            const headerBadge = (
              <span className="flex items-center gap-1.5">
                <TierBadge tier={tier} />
                {badge}
              </span>
            );
            return (
              <NodeShell
                key={node.id}
                title={sourceTitle}
                subtitle={
                  <span className="flex items-center gap-1.5">
                    <span className={cn(accent.split(" ")[3], !isPrimary && "opacity-80")}>
                      {nodeCompound.name}
                    </span>
                    {!isPrimary && (
                      <span className="text-[9px] uppercase tracking-widest text-zinc-600">stack</span>
                    )}
                  </span>
                }
                icon="solar:database-linear"
                warn={tier4Warn}
                collapsible
                collapsed={collapsed[node.id] ?? false}
                onToggleCollapse={() => toggleCollapsed(node.id)}
                {...shared}
                badge={headerBadge}
              >
                <SourceBody
                  tier={tier}
                  compound={nodeCompound}
                  studies={studiesByCompoundTier[`${nodeCompound.id}::tier-${tier}`] ?? []}
                  studiesLoading={studiesLoadingByCompound[nodeCompound.id] === true}
                  excludedStudies={excludedStudies}
                  onToggleStudy={onToggleStudy}
                  modules={modulesByCompound[nodeCompound.id] ?? []}
                />
              </NodeShell>
            );
          }

          if (node.type === "demographics") {
            return (
              <NodeShell
                key={node.id}
                title="Demographics"
                icon="solar:user-linear"
                warn={snapshot.ageExtrapolated}
                collapsible
                collapsed={collapsed[node.id] ?? false}
                onToggleCollapse={() => toggleCollapsed(node.id)}
                summary={demoSummary}
                {...shared}
                footer={
                  snapshot.ageExtrapolated ? (
                    <div className="px-4 py-2.5 bg-amber-500/5 border-t border-amber-500/10 rounded-b-xl flex items-start gap-2">
                      <Icon icon="solar:target-linear" className="text-amber-500 text-sm mt-0.5 shrink-0" />
                      <p className="text-[11px] text-amber-500 leading-snug">
                        <span className="font-medium text-amber-400">Extrapolated:</span> Age {age} exceeds
                        primary study cohort ({primaryCompound.primaryCohortMin}–{primaryCompound.primaryCohortMax}).
                        Confidence penalty applied.
                      </p>
                    </div>
                  ) : undefined
                }
              >
                <DemographicsBody
                  sex={sex}
                  onSexChange={onSexChange}
                  age={age}
                  onAgeChange={onAgeChange}
                  weight={weight}
                  onWeightChange={onWeightChange}
                  dose={dose}
                  onDoseChange={onDoseChange}
                  snapshot={snapshot}
                  compound={primaryCompound}
                />
              </NodeShell>
            );
          }

          if (node.type === "run") {
            return (
              <NodeShell
                key={node.id}
                title="Run"
                icon="solar:play-circle-linear"
                {...shared}
                canMoveUp={false}
                canMoveDown={false}
                showOutputPort={false}
              >
                <RunBody onRun={onRun} snapshot={snapshot} />
              </NodeShell>
            );
          }

          return null;
        })}

        <PaletteButton options={paletteOptions} onAddNode={onAddNode} />
      </div>
    </div>
  );
}
