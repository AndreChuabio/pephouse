import type {
  ChartBar,
  Compound,
  Demographics,
  MetricCard,
  ProvenanceSource,
} from "../types/simulation";

export const MOCK_COMPOUNDS: Compound[] = [
  {
    id: "bpc-157",
    name: "BPC-157",
    tier: "gray-market",
    description: "Body Protective Compound",
    dosage: "500 mcg / daily",
    dosagePercent: 40,
  },
  {
    id: "tirzepatide",
    name: "Tirzepatide",
    tier: "fda-approved",
    description: "GLP-1 / GIP Agonist",
    dosage: "2.5 mg / weekly",
    dosagePercent: 25,
  },
];

export const MOCK_CHART_BARS: ChartBar[] = [
  { id: "base", heightPercent: 15, className: "bg-zinc-800", tooltip: "Month 1" },
  { id: "m2", heightPercent: 32, className: "bg-zinc-700" },
  {
    id: "q2",
    heightPercent: 58,
    className: "bg-blue-900/40 border-t border-blue-500/50",
    highlight: true,
  },
  { id: "m4", heightPercent: 72, className: "bg-zinc-700" },
  { id: "m5", heightPercent: 85, className: "bg-zinc-600" },
  { id: "m6", heightPercent: 92, className: "bg-zinc-600" },
  { id: "m7", heightPercent: 88, className: "bg-zinc-500" },
  { id: "m8", heightPercent: 90, className: "bg-zinc-500" },
  { id: "m9", heightPercent: 94, className: "bg-zinc-400" },
];

export const MOCK_METRICS: MetricCard[] = [
  {
    id: "weight-reduction",
    icon: "solar:graph-up-linear",
    label: "Weight Reduction Prob.",
    value: "82%",
    detail: "for >15% loss",
    progressPercent: 82,
  },
  {
    id: "gi-distress",
    icon: "solar:danger-triangle-linear",
    label: "GI Distress Risk",
    value: "24%",
    detail: "moderate/severe",
    tone: "warning",
    note: "Synergistic interaction noted between BPC-157 and Tirzepatide in extrapolated models.",
  },
  {
    id: "data-confidence",
    icon: "solar:shield-check-linear",
    label: "Data Confidence",
    value: "Low",
    tone: "confidence",
    confidenceLevel: 1,
    note: "Dragged down by BPC-157 reliance on anecdotal scraped data (n=450).",
  },
];

export const MOCK_PROVENANCE: ProvenanceSource[] = [
  {
    id: "nct04184622",
    icon: "solar:document-text-linear",
    label: "ClinicalTrials.gov (NCT04184622)",
    meta: "Tirzepatide Baseline",
  },
  {
    id: "reddit-scrape",
    icon: "solar:global-linear",
    label: "r/Peptides & Web Forums Scrape",
    meta: "n=453 records",
    tier: "anecdotal",
  },
];

export const DEMOGRAPHICS: Demographics = {
  age: 55,
  sex: "M",
  weightKg: 102,
};
