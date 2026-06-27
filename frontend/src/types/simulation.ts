export type EvidenceTier = "gray-market" | "fda-approved";

export type ProvenanceTier = "anecdotal";

export type Compound = {
  id: string;
  name: string;
  tier: EvidenceTier;
  description: string;
  dosage: string;
  dosagePercent: number;
};

export type ChartBar = {
  id: string;
  heightPercent: number;
  className: string;
  highlight?: boolean;
  tooltip?: string;
};

export type MetricTone = "default" | "warning" | "confidence";

export type MetricCard = {
  id: string;
  icon: string;
  label: string;
  value: string;
  detail?: string;
  note?: string;
  tone?: MetricTone;
  progressPercent?: number;
  confidenceLevel?: 1 | 2 | 3;
};

export type ProvenanceSource = {
  id: string;
  icon: string;
  label: string;
  meta: string;
  tier?: ProvenanceTier;
};

export type Demographics = {
  ageRange: string;
  sex: string;
  weightKg: number;
  weightPercent: number;
  extrapolateComorbidities: boolean;
};
