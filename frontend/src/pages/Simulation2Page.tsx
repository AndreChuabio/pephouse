import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { BuilderCanvas } from "../components/simulation2/BuilderCanvas";
import { BreakdownModal } from "../components/simulation2/BreakdownModal";
import { ReportPanel } from "../components/simulation2/ReportPanel";
import { Simulation2Header } from "../components/simulation2/Simulation2Header";
import {
  COMPOUND_PROFILES,
  computeSnapshot,
  defaultChain,
  FIXED_NODE_TYPES,
  sourceFractionsFor,
  sourceNodesFor,
  studyKey,
  type ChainNode,
  type ChainNodeType,
  type CompoundProfile,
  type Sex,
} from "../data/simulation2";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const INITIAL_COMPOUND_ID = "bpc-157";

export default function Simulation2Page() {
  useDocumentTitle("PepHouse | Simulation Builder");

  const [compoundIds, setCompoundIds] = useState<string[]>([INITIAL_COMPOUND_ID]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sex, setSex] = useState<Sex>("M");
  const [age, setAge] = useState(62);
  const [weight, setWeight] = useState(102);
  const [dose, setDose] = useState(500);
  const [hasRun, setHasRun] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(true);

  const compounds = useMemo(
    () =>
      compoundIds
        .map((id) => COMPOUND_PROFILES[id])
        .filter((c): c is CompoundProfile => Boolean(c)),
    [compoundIds],
  );
  const primaryCompound = compounds[0] ?? COMPOUND_PROFILES[INITIAL_COMPOUND_ID];
  const extraCompounds = compounds.slice(1);

  const [nodes, setNodes] = useState<ChainNode[]>(() =>
    defaultChain(COMPOUND_PROFILES[INITIAL_COMPOUND_ID]),
  );

  const toggleCompound = useCallback((id: string) => {
    setCompoundIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        setNodes((n) => n.filter((node) => node.compoundId !== id));
        return next;
      }
      const compound = COMPOUND_PROFILES[id];
      if (!compound) return prev;
      setNodes((n) => {
        const runIdx = n.findIndex((node) => node.type === "run");
        const demoIdx = n.findIndex((node) => node.type === "demographics");
        const insertAt = demoIdx !== -1 ? demoIdx : runIdx !== -1 ? runIdx : n.length;
        const newSourceNodes = sourceNodesFor(compound);
        return [...n.slice(0, insertAt), ...newSourceNodes, ...n.slice(insertAt)];
      });
      return [...prev, id];
    });
  }, []);

  const [excludedStudies, setExcludedStudies] = useState<Record<string, boolean>>({});

  const sourceFractions = useMemo(
    () => sourceFractionsFor(nodes, primaryCompound, excludedStudies),
    [nodes, primaryCompound, excludedStudies],
  );
  const runPresent = useMemo(() => nodes.some((n) => n.type === "run"), [nodes]);

  const snapshot = useMemo(
    () =>
      computeSnapshot({
        compound: primaryCompound,
        extraCompounds,
        sourceFractions,
        age,
      }),
    [primaryCompound, extraCompounds, sourceFractions, age],
  );

  const toggleStudy = useCallback((compoundId: string, tier: 1 | 2 | 3 | 4, title: string) => {
    setExcludedStudies((prev) => {
      const key = studyKey(compoundId, tier, title);
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }, []);

  const addNode = useCallback((type: ChainNodeType, compoundId?: string) => {
    setNodes((prev) => {
      const nodeId = compoundId ? `${type}-${compoundId}` : type;
      if (prev.some((n) => n.id === nodeId)) return prev;
      const newNode: ChainNode = { id: nodeId, type, compoundId };
      const runIdx = prev.findIndex((n) => n.type === "run");
      if (runIdx === -1) return [...prev, newNode];
      return [...prev.slice(0, runIdx), newNode, ...prev.slice(runIdx)];
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => {
      const target = prev.find((n) => n.id === id);
      if (!target || target.type === "compound" || FIXED_NODE_TYPES.has(target.type)) return prev;
      return prev.filter((n) => n.id !== id);
    });
  }, []);

  const moveNode = useCallback(
    (id: string, direction: -1 | 1) => {
      setNodes((prev) => {
        const idx = prev.findIndex((n) => n.id === id);
        if (idx === -1) return prev;
        const target = idx + direction;
        const lastIdx = prev.length - 1 - (runPresent && prev[prev.length - 1]?.type === "run" ? 1 : 0);
        if (target < 0 || target > lastIdx) return prev;
        const next = [...prev];
        [next[idx], next[target]] = [next[target], next[idx]];
        return next;
      });
    },
    [runPresent],
  );

  const handleRun = () => {
    setHasRun(true);
  };

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.trim().toLowerCase();
    const match = Object.values(COMPOUND_PROFILES).find(
      (c) =>
        c.id === q ||
        c.name.toLowerCase().includes(q) ||
        c.searchTerms.some((t) => t.includes(q) || q.includes(t)),
    );
    if (match && !compoundIds.includes(match.id)) {
      toggleCompound(match.id);
      setSearchQuery("");
    }
  }, [searchQuery, compoundIds, toggleCompound]);

  return (
    <AppShell>
      <Simulation2Header onRun={handleRun} />

      <div className="flex-1 flex overflow-hidden bg-[#0A0A0A] min-h-0">
        <BuilderCanvas
          nodes={nodes}
          onAddNode={addNode}
          onRemoveNode={removeNode}
          onMoveNode={moveNode}
          onRun={handleRun}
          compounds={compounds}
          primaryCompound={primaryCompound}
          compoundIds={compoundIds}
          onToggleCompound={toggleCompound}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          sex={sex}
          onSexChange={setSex}
          age={age}
          onAgeChange={setAge}
          weight={weight}
          onWeightChange={setWeight}
          dose={dose}
          onDoseChange={setDose}
          snapshot={snapshot}
          excludedStudies={excludedStudies}
          onToggleStudy={toggleStudy}
          sourceFractions={sourceFractions}
        />

        <ReportPanel
          hasRun={hasRun}
          audience="clinician"
          compound={primaryCompound}
          snapshot={snapshot}
          onOpenBreakdown={() => setBreakdownOpen(true)}
          open={reportOpen}
          onToggleOpen={() => setReportOpen((v) => !v)}
        />
      </div>

      <BreakdownModal
        open={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        compound={primaryCompound}
        snapshot={snapshot}
      />
    </AppShell>
  );
}
