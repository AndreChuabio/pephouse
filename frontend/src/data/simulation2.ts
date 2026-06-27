export type AudienceMode = "clinician" | "individual";
export type Sex = "M" | "F";
export type ConfidenceLevel = "High" | "Moderate" | "Low";
export type EvidenceTier = 1 | 2 | 3 | 4;

export type StudyRef = {
  title: string;
  meta?: string;
  url?: string;
};

export type EvidenceSource = {
  id: string;
  label: string;
  tier: EvidenceTier;
  defaultEnabled: boolean;
  summary?: string;
  studies?: StudyRef[];
};

export const PENALTIES = {
  tier4Excluded: 28,
  tier2Off: 12,
  tier1OffBpc: 15,
  ageExtrapolated: 18,
  outsideStudiedRange: 10,
} as const;

export type InteractionSeverityKey = "major" | "moderate" | "minor" | "unknown";

export const SEVERITY_PENALTY: Record<InteractionSeverityKey, number> = {
  major: 30,
  moderate: 15,
  minor: 5,
  unknown: 5,
};

export type InteractionLedgerInput = {
  pairId: string;
  partnerName: string;
  severity: InteractionSeverityKey;
};

export type OutcomeBar = {
  label: string;
  percent: number;
  probabilityLabel?: string;
  detail?: string;
  severity?: "elevated" | "info";
};

export type CompoundProfile = {
  id: string;
  name: string;
  subtitle: string;
  searchTerms: string[];
  regulatoryStatus: string;
  approvalPath: string;
  studiedAgeMin: number;
  studiedAgeMax: number;
  primaryCohortMin: number;
  primaryCohortMax: number;
  baseProfileScore: number;
  evidenceSources: EvidenceSource[];
  benefits: OutcomeBar[];
  sideEffects: OutcomeBar[];
};

export const COMPOUND_PROFILES: Record<string, CompoundProfile> = {
  "bpc-157": {
    id: "bpc-157",
    name: "BPC-157",
    subtitle: "Pentadecapeptide (Arginate)",
    searchTerms: ["bpc", "157", "arginate", "pentadecapeptide"],
    regulatoryStatus: "FDA Category 2 · Not approved · WADA-banned",
    approvalPath: "No FDA approval path; compounding use only in research contexts.",
    studiedAgeMin: 19,
    studiedAgeMax: 60,
    primaryCohortMin: 25,
    primaryCohortMax: 45,
    baseProfileScore: 80,
    evidenceSources: [
      { id: "tier4", label: "Clinical RCTs (Published)", tier: 4, defaultEnabled: true },
      { id: "tier3", label: "Observational / Papers", tier: 3, defaultEnabled: true },
      { id: "tier2", label: "Verified Real-world / Lab Data", tier: 2, defaultEnabled: false },
      { id: "tier1", label: "Anecdotal / Forums", tier: 1, defaultEnabled: true },
    ],
    benefits: [
      { label: "Tendon / joint pain relief", percent: 54, probabilityLabel: "High Prob." },
      { label: "Faster injury recovery", percent: 54, probabilityLabel: "High Prob." },
      { label: "Reduced inflammation", percent: 35, probabilityLabel: "Med Prob." },
      { label: "Gut / GI improvement", percent: 33, probabilityLabel: "Med Prob." },
      { label: "Better sleep", percent: 23, probabilityLabel: "Low Prob." },
    ],
    sideEffects: [
      {
        label: "Angiogenesis acceleration",
        percent: 85,
        probabilityLabel: "Elevated",
        severity: "elevated",
        detail:
          "Tier 2 data suggests potential growth factor stimulation. Theoretical risk for pre-existing tumors — routine screening recommended for older demographics.",
      },
      {
        label: "Injection-site irritation",
        percent: 29,
        probabilityLabel: "Common",
        detail: "Most frequently reported local reaction in Tier 1 sources.",
      },
      {
        label: "GI distress",
        percent: 12,
        probabilityLabel: "Reported",
        detail: "Reported in ~12% of Tier 1 anecdotal sources at doses >400 mcg.",
      },
      { label: "Fatigue", percent: 17 },
      { label: "Headache", percent: 10 },
      { label: "Nausea", percent: 10 },
      { label: "Elevated heart rate", percent: 8 },
    ],
  },
  semaglutide: {
    id: "semaglutide",
    name: "Semaglutide",
    subtitle: "GLP-1 receptor agonist",
    searchTerms: ["sema", "semaglutide", "ozempic", "glp"],
    regulatoryStatus: "FDA-approved · Prescription GLP-1",
    approvalPath: "Approved for type 2 diabetes and chronic weight management (STEP trials).",
    studiedAgeMin: 18,
    studiedAgeMax: 75,
    primaryCohortMin: 30,
    primaryCohortMax: 65,
    baseProfileScore: 86,
    evidenceSources: [
      { id: "tier4", label: "Clinical RCTs (Published)", tier: 4, defaultEnabled: true },
      { id: "tier3", label: "Observational / Papers", tier: 3, defaultEnabled: true },
      { id: "tier2", label: "Verified Real-world / Lab Data", tier: 2, defaultEnabled: true },
      { id: "tier1", label: "Anecdotal / Forums", tier: 1, defaultEnabled: false },
    ],
    benefits: [
      { label: "Meaningful weight loss", percent: 86, probabilityLabel: "High Prob." },
      { label: "Reduced appetite", percent: 80, probabilityLabel: "High Prob." },
      { label: "Improved glycemic control", percent: 62, probabilityLabel: "Med Prob." },
    ],
    sideEffects: [
      { label: "Nausea", percent: 44, probabilityLabel: "Common" },
      { label: "Diarrhea", percent: 30 },
      { label: "Constipation", percent: 24 },
      { label: "Vomiting", percent: 24 },
    ],
  },
};

export const COMPOUND_LIST = Object.values(COMPOUND_PROFILES);

export function findCompound(query: string): CompoundProfile | undefined {
  const q = query.trim().toLowerCase();
  return COMPOUND_LIST.find(
    (c) =>
      c.id === q ||
      c.name.toLowerCase().includes(q) ||
      c.searchTerms.some((t) => t.includes(q) || q.includes(t)),
  );
}

export function defaultSourceState(compound: CompoundProfile): Record<string, boolean> {
  return Object.fromEntries(compound.evidenceSources.map((s) => [s.id, s.defaultEnabled]));
}

export type LedgerLine = { label: string; delta: number; tone?: "positive" | "negative" };

export type SimulationSnapshot = {
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  confidenceReason: string;
  ledger: LedgerLine[];
  degraded: boolean;
  ageExtrapolated: boolean;
  outsideStudiedRange: boolean;
  tier4Excluded: boolean;
};

export function computeSnapshot(input: {
  compound: CompoundProfile;
  extraCompounds: CompoundProfile[];
  sourceFractions: Record<string, number>;
  age: number;
  interactions?: InteractionLedgerInput[];
}): SimulationSnapshot {
  const ledger: LedgerLine[] = [
    { label: `${input.compound.name} base profile`, delta: input.compound.baseProfileScore, tone: "positive" },
  ];

  let score = input.compound.baseProfileScore;
  const frac = (k: string) => Math.max(0, Math.min(1, input.sourceFractions[k] ?? 0));
  const tier4Frac = frac("tier4");
  const tier4Penalty = Math.round(PENALTIES.tier4Excluded * (1 - tier4Frac));
  const tier4HasSource = input.compound.evidenceSources.some((s) => s.tier === 4);
  const tier4Excluded = tier4HasSource && tier4Frac < 1;

  if (tier4Penalty > 0) {
    score -= tier4Penalty;
    ledger.push({
      label: tier4Frac > 0 ? `Tier 4 partial (${Math.round(tier4Frac * 100)}%)` : "Tier 4 Data Excluded",
      delta: -tier4Penalty,
      tone: "negative",
    });
  }

  const tier2Frac = frac("tier2");
  const tier2Penalty = Math.round(PENALTIES.tier2Off * (1 - tier2Frac));
  if (tier2Penalty > 0) {
    score -= tier2Penalty;
    ledger.push({
      label: tier2Frac > 0 ? `Tier 2 partial (${Math.round(tier2Frac * 100)}%)` : "Tier 2 Sources Off",
      delta: -tier2Penalty,
      tone: "negative",
    });
  }

  const tier1Frac = frac("tier1");
  const tier1Penalty = input.compound.id === "bpc-157"
    ? Math.round(PENALTIES.tier1OffBpc * (1 - tier1Frac))
    : 0;
  if (tier1Penalty > 0) {
    score -= tier1Penalty;
    ledger.push({
      label: tier1Frac > 0 ? `Anecdote layer partial (${Math.round(tier1Frac * 100)}%)` : "Anecdote Layer Off",
      delta: -tier1Penalty,
      tone: "negative",
    });
  }

  const outsideStudiedRange = input.age < input.compound.studiedAgeMin || input.age > input.compound.studiedAgeMax;
  const ageExtrapolated =
    input.age < input.compound.primaryCohortMin || input.age > input.compound.primaryCohortMax;

  if (ageExtrapolated) {
    score -= PENALTIES.ageExtrapolated;
    ledger.push({ label: `Age Extrapolation (${input.age} yrs)`, delta: -PENALTIES.ageExtrapolated, tone: "negative" });
  } else if (outsideStudiedRange) {
    score -= PENALTIES.outsideStudiedRange;
    ledger.push({ label: "Outside studied age range", delta: -PENALTIES.outsideStudiedRange, tone: "negative" });
  }

  for (const pair of input.interactions ?? []) {
    const penalty = SEVERITY_PENALTY[pair.severity] ?? SEVERITY_PENALTY.unknown;
    score -= penalty;
    ledger.push({
      label: `${pair.partnerName} interaction (${pair.severity})`,
      delta: -penalty,
      tone: "negative",
    });
  }

  score = Math.max(5, Math.min(95, Math.round(score)));

  let confidenceLevel: ConfidenceLevel = "Low";
  if (score >= 70) confidenceLevel = "High";
  else if (score >= 45) confidenceLevel = "Moderate";

  const degraded = tier4Frac === 0 && tier4HasSource && input.compound.id === "bpc-157";

  let confidenceReason = "Evidence tiers and demographics align with published cohorts.";
  if (degraded) {
    confidenceReason = "Tier 4 evidence excluded — report relies on lower-tier sources.";
  } else if (ageExtrapolated) {
    confidenceReason = "Age extrapolated beyond primary study cohort — confidence penalized.";
  } else if (confidenceLevel === "High") {
    confidenceReason = "Trial-backed compound with Tier 4 sources enabled.";
  } else if (confidenceLevel === "Moderate") {
    confidenceReason = "Mixed-tier evidence or partial extrapolation.";
  } else {
    confidenceReason = "Low-tier or anecdote-heavy evidence base.";
  }

  return {
    confidenceScore: score,
    confidenceLevel,
    confidenceReason,
    ledger,
    degraded,
    ageExtrapolated,
    outsideStudiedRange,
    tier4Excluded,
  };
}

export function barOpacity(confidenceScore: number): number {
  return Math.max(0.25, confidenceScore / 100);
}

export type ChainNodeType =
  | "compound"
  | "interactions"
  | "source-tier-1"
  | "source-tier-2"
  | "source-tier-3"
  | "source-tier-4"
  | "demographics"
  | "run";

export type ChainNode = { id: string; type: ChainNodeType; compoundId?: string };

export const FIXED_NODE_TYPES: ReadonlySet<ChainNodeType> = new Set();

const SOURCE_TIER_BY_NODE_TYPE: Partial<Record<ChainNodeType, 1 | 2 | 3 | 4>> = {
  "source-tier-1": 1,
  "source-tier-2": 2,
  "source-tier-3": 3,
  "source-tier-4": 4,
};

export function sourceTier(type: ChainNodeType): 1 | 2 | 3 | 4 | null {
  return SOURCE_TIER_BY_NODE_TYPE[type] ?? null;
}

export function sourceNodeId(tier: 1 | 2 | 3 | 4, compoundId: string): string {
  return `source-tier-${tier}-${compoundId}`;
}

export function sourceNodesFor(compound: CompoundProfile): ChainNode[] {
  return compound.evidenceSources
    .filter((s) => s.defaultEnabled)
    .sort((a, b) => b.tier - a.tier)
    .map((s) => ({
      id: sourceNodeId(s.tier, compound.id),
      type: `source-tier-${s.tier}` as ChainNodeType,
      compoundId: compound.id,
    }));
}

export function defaultChain(compound: CompoundProfile): ChainNode[] {
  return [
    { id: "compound", type: "compound" },
    { id: "demographics", type: "demographics" },
    ...sourceNodesFor(compound),
    { id: "run", type: "run" },
  ];
}

export function enabledSourcesFor(nodes: ChainNode[], compoundId: string): Record<string, boolean> {
  const enabled: Record<string, boolean> = { tier1: false, tier2: false, tier3: false, tier4: false };
  for (const node of nodes) {
    if (node.compoundId !== compoundId) continue;
    const tier = sourceTier(node.type);
    if (tier) enabled[`tier${tier}`] = true;
  }
  return enabled;
}

export function studyKey(compoundId: string, tier: 1 | 2 | 3 | 4, title: string): string {
  return `${compoundId}::tier-${tier}::${title}`;
}

export function sourceFractionsFor(
  nodes: ChainNode[],
  compound: CompoundProfile,
  excludedStudies: Record<string, boolean>,
): Record<string, number> {
  const presentTiers = new Set<number>();
  for (const node of nodes) {
    if (node.compoundId !== compound.id) continue;
    const tier = sourceTier(node.type);
    if (tier) presentTiers.add(tier);
  }
  const fractions: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
  for (const source of compound.evidenceSources) {
    if (!presentTiers.has(source.tier)) continue;
    const studies = source.studies ?? [];
    if (studies.length === 0) {
      fractions[`tier${source.tier}`] = 1;
      continue;
    }
    const included = studies.filter((s) => !excludedStudies[studyKey(compound.id, source.tier, s.title)]).length;
    fractions[`tier${source.tier}`] = included / studies.length;
  }
  return fractions;
}

export function nodeLabel(
  type: ChainNodeType,
  compound: CompoundProfile | null = null,
): string {
  switch (type) {
    case "compound":
      return "Compound";
    case "interactions":
      return "Drug Interactions";
    case "demographics":
      return "Demographics";
    case "run":
      return "Run";
    default: {
      const tier = sourceTier(type);
      if (!tier) return type;
      const match = compound?.evidenceSources.find((s) => s.tier === tier);
      const base = match ? match.label : `Tier ${tier}`;
      return compound ? `${base} · ${compound.name}` : base;
    }
  }
}
