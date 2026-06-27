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
  sourceTier,
  studyKey,
  type ChainNode,
  type ChainNodeType,
  type CompoundProfile,
  type Sex,
} from "../data/simulation2";
import { studiesFromBundle } from "../data/registryStudies";
import { synthesizeProfile } from "../data/synthesizeProfile";
import { useCompoundData } from "../hooks/useCompoundData";
import { useCompoundRegistry } from "../hooks/useCompoundRegistry";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import type { StudyRef } from "../data/simulation2";

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

  const registry = useCompoundRegistry();
  const { bundles, loading: bundleLoading, errors: bundleErrors } = useCompoundData(
    compoundIds,
    registry,
  );

  const profileBySlug = useMemo(() => {
    const out: Record<string, CompoundProfile> = { ...COMPOUND_PROFILES };
    for (const [slug, entry] of Object.entries(registry.bySlug)) {
      if (out[slug]) continue;
      out[slug] = synthesizeProfile(entry, bundles[slug]);
    }
    return out;
  }, [registry.bySlug, bundles]);

  const compoundList = useMemo(
    () => Object.values(profileBySlug).sort((a, b) => a.name.localeCompare(b.name)),
    [profileBySlug],
  );

  const compounds = useMemo(
    () =>
      compoundIds
        .map((id) => profileBySlug[id])
        .filter((c): c is CompoundProfile => Boolean(c)),
    [compoundIds, profileBySlug],
  );
  const primaryCompound = compounds[0] ?? profileBySlug[INITIAL_COMPOUND_ID];
  const extraCompounds = compounds.slice(1);

  const [nodes, setNodes] = useState<ChainNode[]>(() =>
    defaultChain(COMPOUND_PROFILES[INITIAL_COMPOUND_ID]),
  );

  const toggleCompound = useCallback(
    (id: string) => {
      setCompoundIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
    },
    [],
  );

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

  const studiesByCompoundTier = useMemo(() => {
    const out: Record<string, StudyRef[]> = {};
    for (const c of compounds) {
      const bundle = bundles[c.id];
      for (const tier of [1, 2, 3, 4] as const) {
        out[`${c.id}::tier-${tier}`] = studiesFromBundle(bundle, tier);
      }
    }
    return out;
  }, [compounds, bundles]);

  const studiesLoadingByCompound = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const id of compoundIds) {
      out[id] = !registry.loaded || (!bundles[id] && !bundleErrors[id]);
    }
    return out;
  }, [compoundIds, bundles, bundleErrors, bundleLoading, registry.loaded]);

  if (registry.error) console.warn("[Sim2] registry failed:", registry.error);
  for (const id of compoundIds) {
    if (bundleErrors[id]) console.warn(`[Sim2] bundle for ${id} failed:`, bundleErrors[id]);
  }

  useEffect(() => {
    setNodes((prev) => {
      const next = prev.filter((node) => {
        const tier = sourceTier(node.type);
        if (!tier || !node.compoundId) return true;
        const bundle = bundles[node.compoundId];
        if (!bundle) return true;
        return studiesFromBundle(bundle, tier).length > 0;
      });
      // Same-length guard prevents an infinite loop now that nodes is in deps.
      return next.length === prev.length ? prev : next;
    });
  }, [bundles, nodes]);

  useEffect(() => {
    setNodes((prev) => {
      let next = prev.filter((n) => !n.compoundId || compoundIds.includes(n.compoundId));
      for (const id of compoundIds) {
        const hasSourceNodes = next.some((n) => n.compoundId === id && sourceTier(n.type));
        if (hasSourceNodes) continue;
        const profile = profileBySlug[id];
        if (!profile) continue;
        const newSources = sourceNodesFor(profile);
        if (newSources.length === 0) continue;
        const runIdx = next.findIndex((n) => n.type === "run");
        const demoIdx = next.findIndex((n) => n.type === "demographics");
        const insertAt = demoIdx !== -1 ? demoIdx : runIdx !== -1 ? runIdx : next.length;
        next = [...next.slice(0, insertAt), ...newSources, ...next.slice(insertAt)];
      }
      return next.length === prev.length && next.every((n, i) => n === prev[i]) ? prev : next;
    });
  }, [compoundIds, profileBySlug]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.trim().toLowerCase();
    const match = compoundList.find(
      (c) =>
        c.id === q ||
        c.name.toLowerCase().includes(q) ||
        c.searchTerms.some((t) => t.includes(q) || q.includes(t)),
    );
    if (match && !compoundIds.includes(match.id)) {
      toggleCompound(match.id);
      setSearchQuery("");
    }
  }, [searchQuery, compoundIds, compoundList, toggleCompound]);

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
          compoundList={compoundList}
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
          studiesByCompoundTier={studiesByCompoundTier}
          studiesLoadingByCompound={studiesLoadingByCompound}
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
