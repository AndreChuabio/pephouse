import type { EvidenceTier, ProvenanceTier } from "../types/simulation";

type Badge = {
  label: string;
  className: string;
};

const TIER_BADGE: Record<EvidenceTier, Badge> = {
  "gray-market": {
    label: "Gray Mkt",
    className:
      "text-[0.65rem] uppercase tracking-widest bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium",
  },
  "fda-approved": {
    label: "FDA Apprv",
    className:
      "text-[0.65rem] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium",
  },
};

const PROVENANCE_BADGE: Record<ProvenanceTier, Badge> = {
  anecdotal: {
    label: "Anecdotal",
    className:
      "px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
  trial: {
    label: "Trial",
    className:
      "px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
};

export function getTierBadge(tier: EvidenceTier): Badge {
  return TIER_BADGE[tier];
}

export function getProvenanceBadge(tier: ProvenanceTier): Badge {
  return PROVENANCE_BADGE[tier];
}
