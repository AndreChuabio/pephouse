export type AudienceMode = "clinician" | "individual";
export type Sex = "M" | "F";
export type ConfidenceLevel = "High" | "Moderate" | "Low";
export type EvidenceTier = 1 | 2 | 3 | 4;

export type EvidenceSource = {
  id: string;
  label: string;
  tier: EvidenceTier;
  defaultEnabled: boolean;
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
      { id: "tier4", label: "Clinical RCTs (Published)", tier: 4, defaultEnabled: false },
      { id: "tier3", label: "Observational Cohorts", tier: 3, defaultEnabled: false },
      { id: "tier2", label: "In-vivo Animal Studies", tier: 2, defaultEnabled: true },
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
      { id: "tier3", label: "Observational Cohorts", tier: 3, defaultEnabled: true },
      { id: "tier2", label: "Verified Real-world Data", tier: 2, defaultEnabled: true },
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
  stackCompound: CompoundProfile | null;
  enabledSources: Record<string, boolean>;
  age: number;
}): SimulationSnapshot {
  const ledger: LedgerLine[] = [
    { label: "Base Compound Profile", delta: input.compound.baseProfileScore, tone: "positive" },
  ];

  let score = input.compound.baseProfileScore;
  const tier4On = input.enabledSources.tier4 === true;
  const tier4Excluded = !tier4On && input.compound.evidenceSources.some((s) => s.id === "tier4");

  if (tier4Excluded) {
    score -= 28;
    ledger.push({ label: "Tier 4 Data Excluded", delta: -28, tone: "negative" });
  }

  if (!input.enabledSources.tier2) {
    score -= 12;
    ledger.push({ label: "Tier 2 Sources Off", delta: -12, tone: "negative" });
  }

  if (!input.enabledSources.tier1 && input.compound.id === "bpc-157") {
    score -= 15;
    ledger.push({ label: "Anecdote Layer Off", delta: -15, tone: "negative" });
  }

  const outsideStudiedRange = input.age < input.compound.studiedAgeMin || input.age > input.compound.studiedAgeMax;
  const ageExtrapolated =
    input.age < input.compound.primaryCohortMin || input.age > input.compound.primaryCohortMax;

  if (ageExtrapolated) {
    score -= 18;
    ledger.push({ label: `Age Extrapolation (${input.age} yrs)`, delta: -18, tone: "negative" });
  } else if (outsideStudiedRange) {
    score -= 10;
    ledger.push({ label: "Outside studied age range", delta: -10, tone: "negative" });
  }

  if (input.stackCompound) {
    score -= 10;
    ledger.push({ label: "Stack interaction penalty", delta: -10, tone: "negative" });
  }

  score = Math.max(5, Math.min(95, Math.round(score)));

  let confidenceLevel: ConfidenceLevel = "Low";
  if (score >= 70) confidenceLevel = "High";
  else if (score >= 45) confidenceLevel = "Moderate";

  const degraded = tier4Excluded && input.compound.id === "bpc-157";

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
  | "stack"
  | "source-tier-1"
  | "source-tier-2"
  | "source-tier-3"
  | "source-tier-4"
  | "demographics"
  | "run";

export type ChainNode = { id: string; type: ChainNodeType };

export const FIXED_NODE_TYPES: ReadonlySet<ChainNodeType> = new Set(["compound", "demographics"]);

const SOURCE_TIER_BY_NODE_TYPE: Partial<Record<ChainNodeType, 1 | 2 | 3 | 4>> = {
  "source-tier-1": 1,
  "source-tier-2": 2,
  "source-tier-3": 3,
  "source-tier-4": 4,
};

export function sourceTier(type: ChainNodeType): 1 | 2 | 3 | 4 | null {
  return SOURCE_TIER_BY_NODE_TYPE[type] ?? null;
}

export function defaultChain(compound: CompoundProfile): ChainNode[] {
  const sources: ChainNode[] = compound.evidenceSources
    .filter((s) => s.defaultEnabled)
    .sort((a, b) => b.tier - a.tier)
    .map((s) => ({ id: `source-tier-${s.tier}`, type: `source-tier-${s.tier}` as ChainNodeType }));
  return [
    { id: "compound", type: "compound" },
    ...sources,
    { id: "demographics", type: "demographics" },
    { id: "run", type: "run" },
  ];
}

export function enabledSourcesFromNodes(nodes: ChainNode[]): Record<string, boolean> {
  const enabled: Record<string, boolean> = { tier1: false, tier2: false, tier3: false, tier4: false };
  for (const node of nodes) {
    const tier = sourceTier(node.type);
    if (tier) enabled[`tier${tier}`] = true;
  }
  return enabled;
}

export function nodeLabel(type: ChainNodeType, compound: CompoundProfile | null = null): string {
  switch (type) {
    case "compound":
      return "Compound";
    case "stack":
      return "Stack Compound";
    case "demographics":
      return "Demographics";
    case "run":
      return "Run";
    default: {
      const tier = sourceTier(type);
      if (!tier) return type;
      const match = compound?.evidenceSources.find((s) => s.tier === tier);
      return match ? match.label : `Tier ${tier} Source`;
    }
  }
}
