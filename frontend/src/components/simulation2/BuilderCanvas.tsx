import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import {
  COMPOUND_LIST,
  FIXED_NODE_TYPES,
  nodeLabel,
  sourceTier,
  type ChainNode,
  type ChainNodeType,
  type CompoundProfile,
  type Sex,
  type SimulationSnapshot,
} from "../../data/simulation2";
import { cn } from "../../lib/cn";
import { CustomCheckbox, TierBadge } from "./Sim2Primitives";

type BuilderCanvasProps = {
  nodes: ChainNode[];
  onAddNode: (type: ChainNodeType) => void;
  onRemoveNode: (id: string) => void;
  onMoveNode: (id: string, direction: -1 | 1) => void;
  onRun: () => void;
  compound: CompoundProfile;
  stackCompound: CompoundProfile | null;
  onStackCompoundChange: (id: string | null) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onCompoundSelect: (id: string) => void;
  sex: Sex;
  onSexChange: (sex: Sex) => void;
  age: number;
  onAgeChange: (age: number) => void;
  weight: number;
  onWeightChange: (weight: number) => void;
  dose: number;
  onDoseChange: (dose: number) => void;
  snapshot: SimulationSnapshot;
};

type NodeShellProps = {
  title: string;
  icon: string;
  badge?: React.ReactNode;
  active?: boolean;
  warn?: boolean;
  canRemove?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  showInputPort?: boolean;
  showOutputPort?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

function PortDot({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-zinc-700 bg-[#0A0A0A]",
        side === "left" ? "-left-[5px]" : "-right-[5px]",
      )}
    />
  );
}

function NodeShell({
  title,
  icon,
  badge,
  active = true,
  warn = false,
  canRemove = false,
  canMoveUp = false,
  canMoveDown = false,
  onRemove,
  onMoveUp,
  onMoveDown,
  showInputPort = true,
  showOutputPort = true,
  children,
  footer,
}: NodeShellProps) {
  const hasControls = canRemove || canMoveUp || canMoveDown;
  return (
    <div
      className={cn(
        "group w-72 bg-[#121212] border border-zinc-800 rounded-xl relative sim2-node-connector shrink-0",
        active && "sim2-node-connector-active",
        warn && "border-amber-500/30 ring-1 ring-amber-500/10",
      )}
    >
      {showInputPort && <PortDot side="left" />}
      {showOutputPort && <PortDot side="right" />}
      <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded border border-zinc-800 flex items-center justify-center bg-zinc-900 shrink-0">
            <Icon icon={icon} className="text-zinc-400 text-xs" />
          </div>
          <h2 className="text-sm font-medium tracking-tight text-zinc-100 truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {badge}
          {hasControls && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
      <div className="p-4">{children}</div>
      {footer}
    </div>
  );
}

type CompoundBodyProps = {
  compound: CompoundProfile;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onCompoundSelect: (id: string) => void;
};

function CompoundBody({ compound, searchQuery, onSearchQueryChange, onCompoundSelect }: CompoundBodyProps) {
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
      <div className="space-y-2">
        {COMPOUND_LIST.map((c) => (
          <label key={c.id} className="flex items-start gap-2 cursor-pointer group/item">
            <CustomCheckbox
              checked={compound.id === c.id}
              onChange={() => onCompoundSelect(c.id)}
            />
            <div>
              <span className="text-xs text-zinc-200 block font-medium">{c.name}</span>
              <span className="text-[11px] text-zinc-500 block leading-tight mt-0.5">
                {c.subtitle}
              </span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

type StackBodyProps = {
  compound: CompoundProfile;
  stackCompound: CompoundProfile | null;
  onStackCompoundChange: (id: string | null) => void;
};

function StackBody({ compound, stackCompound, onStackCompoundChange }: StackBodyProps) {
  const options = COMPOUND_LIST.filter((c) => c.id !== compound.id);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500 leading-snug">
        Second compound stacked with the primary. Confidence is penalized for interaction uncertainty.
      </p>
      <select
        value={stackCompound?.id ?? ""}
        onChange={(e) => onStackCompoundChange(e.target.value || null)}
        className="w-full bg-[#0A0A0A] border border-zinc-800 rounded-md px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
      >
        <option value="">Select stack compound…</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

type SourceBodyProps = {
  tier: 1 | 2 | 3 | 4;
  compound: CompoundProfile;
};

function SourceBody({ tier, compound }: SourceBodyProps) {
  const source = compound.evidenceSources.find((s) => s.tier === tier);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-200">{source?.label ?? `Tier ${tier} Source`}</span>
        <TierBadge tier={tier} />
      </div>
      <p className="text-[11px] text-zinc-500 leading-snug">
        Present in chain — contributes to confidence. Remove this card to exclude this tier.
      </p>
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

type PaletteButtonProps = {
  options: { type: ChainNodeType; label: string }[];
  onAddNode: (type: ChainNodeType) => void;
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

  return (
    <div ref={wrapRef} className="relative shrink-0 self-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "w-14 h-14 rounded-full border border-dashed flex items-center justify-center transition-colors",
          disabled
            ? "border-zinc-800 text-zinc-700 cursor-not-allowed"
            : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100 bg-[#0A0A0A]",
        )}
        title={disabled ? "No additional nodes available" : "Add node"}
      >
        <Icon icon="solar:add-circle-linear" className="text-xl" />
      </button>
      {open && options.length > 0 && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-56 bg-[#121212] border border-zinc-800 rounded-lg shadow-xl z-20 overflow-hidden">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800">
            Add to chain
          </div>
          <ul>
            {options.map((opt) => (
              <li key={opt.type}>
                <button
                  type="button"
                  onClick={() => {
                    onAddNode(opt.type);
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
  compound,
  stackCompound,
  onStackCompoundChange,
  searchQuery,
  onSearchQueryChange,
  onCompoundSelect,
  sex,
  onSexChange,
  age,
  onAgeChange,
  weight,
  onWeightChange,
  dose,
  onDoseChange,
  snapshot,
}: BuilderCanvasProps) {
  const runIdx = nodes.findIndex((n) => n.type === "run");
  const lastMovableIdx = runIdx === -1 ? nodes.length - 1 : runIdx - 1;

  const presentTypes = useMemo(() => new Set(nodes.map((n) => n.type)), [nodes]);
  const paletteOptions = useMemo(() => {
    const candidates: ChainNodeType[] = [
      "stack",
      "source-tier-4",
      "source-tier-3",
      "source-tier-2",
      "source-tier-1",
      "run",
    ];
    return candidates
      .filter((t) => !presentTypes.has(t))
      .map((type) => ({ type, label: nodeLabel(type, compound) }));
  }, [presentTypes, compound]);

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
          const isFixed = FIXED_NODE_TYPES.has(node.type);
          const isRun = node.type === "run";
          const canRemove = !isFixed;
          const canMoveUp = !isFixed && !isRun && i > 1;
          const canMoveDown = !isFixed && !isRun && i < lastMovableIdx;
          const showInputPort = i > 0;
          const showOutputPort = i < nodes.length - 1;

          const shared = {
            canRemove,
            canMoveUp,
            canMoveDown,
            onRemove: () => onRemoveNode(node.id),
            onMoveUp: () => onMoveNode(node.id, -1),
            onMoveDown: () => onMoveNode(node.id, 1),
            showInputPort,
            showOutputPort,
          };

          if (node.type === "compound") {
            return (
              <NodeShell key={node.id} title="Compound" icon="solar:test-tube-linear" {...shared}>
                <CompoundBody
                  compound={compound}
                  searchQuery={searchQuery}
                  onSearchQueryChange={onSearchQueryChange}
                  onCompoundSelect={onCompoundSelect}
                />
              </NodeShell>
            );
          }

          if (node.type === "stack") {
            return (
              <NodeShell
                key={node.id}
                title="Stack Compound"
                icon="solar:layers-linear"
                badge={
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-zinc-800 text-zinc-400 border border-zinc-700">
                    optional
                  </span>
                }
                {...shared}
              >
                <StackBody
                  compound={compound}
                  stackCompound={stackCompound}
                  onStackCompoundChange={onStackCompoundChange}
                />
              </NodeShell>
            );
          }

          const tier = sourceTier(node.type);
          if (tier) {
            const tier4Warn = tier === 4 && snapshot.tier4Excluded === false && snapshot.degraded;
            return (
              <NodeShell
                key={node.id}
                title={`Source · Tier ${tier}`}
                icon="solar:database-linear"
                warn={tier4Warn}
                {...shared}
              >
                <SourceBody tier={tier} compound={compound} />
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
                {...shared}
                footer={
                  snapshot.ageExtrapolated ? (
                    <div className="px-4 py-2.5 bg-amber-500/5 border-t border-amber-500/10 rounded-b-xl flex items-start gap-2">
                      <Icon icon="solar:target-linear" className="text-amber-500 text-sm mt-0.5 shrink-0" />
                      <p className="text-[11px] text-amber-500 leading-snug">
                        <span className="font-medium text-amber-400">Extrapolated:</span> Age {age} exceeds
                        primary study cohort ({compound.primaryCohortMin}–{compound.primaryCohortMax}).
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
                  compound={compound}
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
                badge={
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    terminal
                  </span>
                }
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

        {!nodes.some((n) => sourceTier(n.type)) && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-1.5">
            No evidence sources in chain — confidence will collapse.
          </div>
        )}
      </div>
    </div>
  );
}
