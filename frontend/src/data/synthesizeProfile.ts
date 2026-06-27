import type { RegistryCompound, SimulationDataResponse } from "../lib/api";
import type { CompoundProfile, EvidenceTier } from "./simulation2";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const FALLBACK_EVIDENCE_SOURCES = [
  { id: "tier4", label: "Clinical RCTs", tier: 4 as EvidenceTier, defaultEnabled: true },
  { id: "tier3", label: "Observational / Papers", tier: 3 as EvidenceTier, defaultEnabled: true },
  { id: "tier2", label: "Verified Real-world / Lab", tier: 2 as EvidenceTier, defaultEnabled: false },
  { id: "tier1", label: "Anecdotal / Forums", tier: 1 as EvidenceTier, defaultEnabled: false },
];

export function synthesizeProfile(
  entry: RegistryCompound,
  bundle?: SimulationDataResponse,
): CompoundProfile {
  const id = slugify(entry.name);
  const evidenceSources = bundle
    ? bundle.evidence_sources.map((s) => ({
        id: `tier${s.display_tier}`,
        label: s.label,
        tier: s.display_tier as EvidenceTier,
        defaultEnabled: s.available,
      }))
    : FALLBACK_EVIDENCE_SOURCES;

  const studiedMin = bundle?.studied_age_min ?? 18;
  const studiedMax = bundle?.studied_age_max ?? 75;

  return {
    id,
    name: entry.name,
    subtitle: entry.drug_class ?? "compound",
    searchTerms: [entry.name.toLowerCase(), ...((entry.aliases ?? []).map((a) => a.toLowerCase()))],
    regulatoryStatus: entry.fda_status ?? "research_only",
    approvalPath: entry.summary ?? "",
    studiedAgeMin: studiedMin,
    studiedAgeMax: studiedMax,
    primaryCohortMin: studiedMin + 5,
    primaryCohortMax: studiedMax - 5,
    baseProfileScore: 75,
    evidenceSources,
    benefits: [],
    sideEffects: [],
  };
}

export { slugify };
