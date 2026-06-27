import type { SyntheaState } from "../../lib/api";
import { cn } from "../../lib/cn";

const STATE_FILL: Record<string, string> = {
  Initial: "#10b981",
  Terminal: "#ef4444",
  Guard: "#f59e0b",
  Encounter: "#3b82f6",
  Observation: "#8b5cf6",
  Procedure: "#0ea5e9",
  MedicationOrder: "#06b6d4",
  ConditionOnset: "#a78bfa",
  Delay: "#71717a",
  Death: "#1f1f23",
};

type Transition = { target: string; label: string };

function transitionsOf(state: SyntheaState): Transition[] {
  if (typeof state.direct_transition === "string") {
    return [{ target: state.direct_transition, label: "" }];
  }
  const out: Transition[] = [];
  if (state.distributed_transition) {
    for (const t of state.distributed_transition) {
      out.push({
        target: t.transition,
        label: typeof t.distribution === "number" ? `${Math.round(t.distribution * 100)}%` : "",
      });
    }
  }
  if (state.conditional_transition) {
    for (const t of state.conditional_transition) {
      const cond = (t.condition || {}) as { condition_type?: string };
      out.push({ target: t.transition, label: cond.condition_type ?? "if" });
    }
  }
  return out;
}

type Pos = { col: number; row: number };

function layout(states: Record<string, SyntheaState>): {
  positions: Record<string, Pos>;
  cols: number;
  rows: number;
} {
  const initial =
    Object.keys(states).find((n) => states[n]?.type === "Initial") ?? Object.keys(states)[0];
  if (!initial) return { positions: {}, cols: 0, rows: 0 };
  const depth: Record<string, number> = { [initial]: 0 };
  const queue: string[] = [initial];
  while (queue.length) {
    const name = queue.shift()!;
    for (const t of transitionsOf(states[name] ?? ({} as SyntheaState))) {
      if (!(t.target in states) || t.target in depth) continue;
      depth[t.target] = depth[name] + 1;
      queue.push(t.target);
    }
  }
  let maxDepth = 0;
  for (const d of Object.values(depth)) maxDepth = Math.max(maxDepth, d);
  for (const name of Object.keys(states)) if (!(name in depth)) depth[name] = ++maxDepth;

  const byDepth: Record<number, string[]> = {};
  for (const [name, d] of Object.entries(depth)) (byDepth[d] ??= []).push(name);
  for (const d of Object.keys(byDepth)) byDepth[Number(d)].sort();

  const positions: Record<string, Pos> = {};
  let maxCol = 0;
  for (const [d, names] of Object.entries(byDepth)) {
    names.forEach((n, i) => {
      positions[n] = { col: i, row: Number(d) };
    });
    maxCol = Math.max(maxCol, names.length);
  }
  return { positions, cols: maxCol, rows: maxDepth + 1 };
}

const NODE_W = 130;
const NODE_H = 36;
const GAP_X = 14;
const GAP_Y = 22;
const PAD = 8;

export function ModuleGraph({ states }: { states: Record<string, SyntheaState> }) {
  const { positions, cols, rows } = layout(states);
  if (rows === 0) return null;
  const width = PAD * 2 + cols * NODE_W + Math.max(0, cols - 1) * GAP_X;
  const height = PAD * 2 + rows * NODE_H + Math.max(0, rows - 1) * GAP_Y;

  const place = (col: number, row: number) => ({
    x: PAD + col * (NODE_W + GAP_X),
    y: PAD + row * (NODE_H + GAP_Y),
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="xMinYMid meet" className="block">
      <defs>
        <marker id="mg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#71717a" />
        </marker>
      </defs>
      {Object.entries(states).flatMap(([from, st]) => {
        const fromPos = positions[from];
        if (!fromPos) return [];
        return transitionsOf(st).map((t, i) => {
          const toPos = positions[t.target];
          if (!toPos) return null;
          const a = place(fromPos.col, fromPos.row);
          const b = place(toPos.col, toPos.row);
          const x1 = a.x + NODE_W / 2;
          const y1 = a.y + NODE_H;
          const x2 = b.x + NODE_W / 2;
          const y2 = b.y;
          const ctrl = Math.max(12, (y2 - y1) / 2);
          const d = `M${x1},${y1} C${x1},${y1 + ctrl} ${x2},${y2 - ctrl} ${x2},${y2}`;
          return (
            <g key={`${from}->${t.target}-${i}`}>
              <path d={d} fill="none" stroke="#71717a" strokeWidth={1} markerEnd="url(#mg-arrow)" />
              {t.label && (
                <text x={(x1 + x2) / 2 + 4} y={(y1 + y2) / 2} fill="#a1a1aa" fontSize={8}>
                  {t.label}
                </text>
              )}
            </g>
          );
        });
      })}
      {Object.entries(states).map(([name, st]) => {
        const p = positions[name];
        if (!p) return null;
        const { x, y } = place(p.col, p.row);
        const fill = STATE_FILL[st.type] ?? "#52525b";
        return (
          <g key={name}>
            <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={5} fill={fill} opacity={0.9} />
            <text x={x + NODE_W / 2} y={y + 14} textAnchor="middle" fontSize={9} fill="white" fontWeight={600}>
              {st.type}
            </text>
            <text x={x + NODE_W / 2} y={y + 27} textAnchor="middle" fontSize={8} fill="#fafafa" opacity={0.85}>
              {name.length > 22 ? name.slice(0, 21) + "…" : name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type StateInspectorProps = {
  states: Record<string, SyntheaState>;
};

export function ModuleStateInspector({ states }: StateInspectorProps) {
  return (
    <div className="space-y-1.5">
      {Object.entries(states).map(([name, st]) => (
        <StateCard key={name} name={name} state={st} />
      ))}
    </div>
  );
}

function StateCard({ name, state }: { name: string; state: SyntheaState }) {
  const transitions = transitionsOf(state);
  return (
    <div className="bg-[#0a0a0a] border border-zinc-800/60 rounded-md overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900/40 border-b border-zinc-800/60">
        <span
          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium"
          style={{ background: (STATE_FILL[state.type] ?? "#52525b") + "33", color: STATE_FILL[state.type] ?? "#a1a1aa" }}
        >
          {state.type}
        </span>
        <code className="text-[10px] text-zinc-200 truncate">{name}</code>
      </div>
      <dl className="px-2 py-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px]">
        {state.type === "Guard" && state.allow && (
          <>
            <dt className="text-zinc-500 uppercase tracking-wider">Allow</dt>
            <dd className="text-zinc-300">
              <span className="text-amber-400 text-[9px] uppercase tracking-wider">
                {state.allow.condition_type ?? "And"}
              </span>
              <ul className="list-disc pl-4 mt-0.5">
                {(state.allow.conditions ?? []).map((c, i) => (
                  <li key={i} className="text-zinc-400">
                    <code className="text-zinc-300">{c.condition_type}</code> {c.operator}{" "}
                    {c.quantity} {c.unit}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {state.encounter_class && (
          <>
            <dt className="text-zinc-500 uppercase tracking-wider">Class</dt>
            <dd className="text-zinc-300">{state.encounter_class}</dd>
          </>
        )}
        {state.category && (
          <>
            <dt className="text-zinc-500 uppercase tracking-wider">Category</dt>
            <dd className="text-zinc-300">{state.category}</dd>
          </>
        )}
        {state.codes && state.codes.length > 0 && (
          <>
            <dt className="text-zinc-500 uppercase tracking-wider">Codes</dt>
            <dd className="text-zinc-300">
              {state.codes.map((c, i) => (
                <div key={i} className="font-mono">
                  <span className="text-zinc-500">{c.system}</span>{" "}
                  <span className="text-zinc-200">{c.code}</span>
                  {c.display && <span className="text-zinc-500"> · {c.display}</span>}
                </div>
              ))}
            </dd>
          </>
        )}
        {state.unit && (
          <>
            <dt className="text-zinc-500 uppercase tracking-wider">Unit</dt>
            <dd className="text-zinc-300 font-mono">{state.unit}</dd>
          </>
        )}
        {state.range && (state.range.low != null || state.range.high != null) && (
          <>
            <dt className="text-zinc-500 uppercase tracking-wider">Range</dt>
            <dd className="text-zinc-300 font-mono">
              [{state.range.low ?? "?"}, {state.range.high ?? "?"}]
            </dd>
          </>
        )}
        <dt className="text-zinc-500 uppercase tracking-wider">Next</dt>
        <dd className="text-zinc-300">
          {transitions.length === 0 ? (
            <em className="text-zinc-600">terminal</em>
          ) : transitions.length === 1 ? (
            <>
              → <code className="text-zinc-200">{transitions[0].target}</code>
              {transitions[0].label && <span className="text-zinc-500"> ({transitions[0].label})</span>}
            </>
          ) : (
            <ul className="space-y-0.5">
              {transitions.map((t, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {t.label && (
                    <span className={cn("text-[9px] font-mono px-1 rounded bg-zinc-800 text-zinc-200")}>
                      {t.label}
                    </span>
                  )}
                  → <code className="text-zinc-200">{t.target}</code>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </div>
  );
}
