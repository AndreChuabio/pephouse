import { useCallback, useEffect, useMemo, useState } from "react";
import { BuilderCanvas } from "../components/simulation2/BuilderCanvas";
import { BreakdownModal } from "../components/simulation2/BreakdownModal";
import { ReportPanel } from "../components/simulation2/ReportPanel";
import { Simulation2Header } from "../components/simulation2/Simulation2Header";
import {
  COMPOUND_PROFILES,
  computeSnapshot,
  defaultChain,
  enabledSourcesFromNodes,
  findCompound,
  FIXED_NODE_TYPES,
  type AudienceMode,
  type ChainNode,
  type ChainNodeType,
  type Sex,
} from "../data/simulation2";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function Simulation2Page() {
  useDocumentTitle("PepHouse | Simulation Builder");

  const [audience, setAudience] = useState<AudienceMode>("clinician");
  const [compoundId, setCompoundId] = useState("bpc-157");
  const [searchQuery, setSearchQuery] = useState("BPC-157");
  const [stackCompoundId, setStackCompoundId] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex>("M");
  const [age, setAge] = useState(62);
  const [weight, setWeight] = useState(102);
  const [dose, setDose] = useState(500);
  const [hasRun, setHasRun] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const compound = COMPOUND_PROFILES[compoundId] ?? COMPOUND_PROFILES["bpc-157"];
  const stackCompound = stackCompoundId ? (COMPOUND_PROFILES[stackCompoundId] ?? null) : null;

  const [nodes, setNodes] = useState<ChainNode[]>(() => defaultChain(compound));

  useEffect(() => {
    setNodes(defaultChain(compound));
    setStackCompoundId(null);
  }, [compoundId]);

  useEffect(() => {
    const match = findCompound(searchQuery);
    if (match && match.id !== compoundId) {
      setCompoundId(match.id);
    }
  }, [searchQuery, compoundId]);

  const enabledSources = useMemo(() => enabledSourcesFromNodes(nodes), [nodes]);
  const stackEnabled = useMemo(() => nodes.some((n) => n.type === "stack"), [nodes]);
  const runPresent = useMemo(() => nodes.some((n) => n.type === "run"), [nodes]);

  const snapshot = useMemo(
    () =>
      computeSnapshot({
        compound,
        stackCompound: stackEnabled ? stackCompound : null,
        enabledSources,
        age,
      }),
    [compound, stackEnabled, stackCompound, enabledSources, age],
  );

  const addNode = useCallback((type: ChainNodeType) => {
    setNodes((prev) => {
      if (prev.some((n) => n.type === type)) return prev;
      const newNode: ChainNode = { id: type, type };
      const runIdx = prev.findIndex((n) => n.type === "run");
      if (runIdx === -1) return [...prev, newNode];
      return [...prev.slice(0, runIdx), newNode, ...prev.slice(runIdx)];
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => {
      const target = prev.find((n) => n.id === id);
      if (!target || FIXED_NODE_TYPES.has(target.type)) return prev;
      if (target.type === "stack") setStackCompoundId(null);
      return prev.filter((n) => n.id !== id);
    });
  }, []);

  const moveNode = useCallback((id: string, direction: -1 | 1) => {
    setNodes((prev) => {
      const idx = prev.findIndex((n) => n.id === id);
      if (idx === -1) return prev;
      const target = idx + direction;
      if (target <= 0 || target >= prev.length - (runPresent ? 1 : 0)) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, [runPresent]);

  const handleCompoundSelect = (id: string) => {
    setCompoundId(id);
    setSearchQuery(COMPOUND_PROFILES[id]?.name ?? id);
  };

  const handleRun = () => {
    setHasRun(true);
  };

  return (
    <div className="bg-[#0A0A0A] text-zinc-100 font-light text-sm h-screen flex flex-col overflow-hidden selection:bg-zinc-800">
      <Simulation2Header
        audience={audience}
        onAudienceChange={setAudience}
        onRun={handleRun}
      />

      <main className="flex-1 flex overflow-hidden bg-[#0A0A0A] min-h-0">
        <BuilderCanvas
          nodes={nodes}
          onAddNode={addNode}
          onRemoveNode={removeNode}
          onMoveNode={moveNode}
          onRun={handleRun}
          compound={compound}
          stackCompound={stackCompound}
          onStackCompoundChange={setStackCompoundId}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onCompoundSelect={handleCompoundSelect}
          sex={sex}
          onSexChange={setSex}
          age={age}
          onAgeChange={setAge}
          weight={weight}
          onWeightChange={setWeight}
          dose={dose}
          onDoseChange={setDose}
          snapshot={snapshot}
        />

        <ReportPanel
          hasRun={hasRun}
          audience={audience}
          compound={compound}
          snapshot={snapshot}
          onOpenBreakdown={() => setBreakdownOpen(true)}
        />
      </main>

      <BreakdownModal
        open={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        compound={compound}
        snapshot={snapshot}
      />
    </div>
  );
}
