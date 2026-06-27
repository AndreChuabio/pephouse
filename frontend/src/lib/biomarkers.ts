import type { LabStatus, LabValue } from "../types/simulation";

// Visual treatment per biomarker status — mirrors the Superpower/Twin dashboard:
// emerald = in range, amber = borderline, pink = out of range.
export type StatusMeta = {
  label: string;
  text: string; // text color class
  dot: string; // status dot bg class
  border: string; // badge border class
  bg: string; // badge bg class
};

const STATUS_META: Record<LabStatus, StatusMeta> = {
  optimal: {
    label: "Optimal",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    border: "border-emerald-900/50",
    bg: "bg-emerald-900/20",
  },
  abnormal: {
    label: "Abnormal",
    text: "text-amber-400",
    dot: "bg-amber-400",
    border: "border-amber-900/50",
    bg: "bg-amber-900/20",
  },
  high: {
    label: "High",
    text: "text-pink-500",
    dot: "bg-pink-500",
    border: "border-pink-900/50",
    bg: "bg-pink-900/20",
  },
  low: {
    label: "Low",
    text: "text-amber-400",
    dot: "bg-amber-400",
    border: "border-amber-900/50",
    bg: "bg-amber-900/20",
  },
};

export function statusMeta(status?: LabStatus | null): StatusMeta {
  return STATUS_META[status ?? "optimal"] ?? STATUS_META.optimal;
}

// ---- Body-system categorization (left rail of the Twin dashboard) ----

export type BodySystem = {
  key: string;
  label: string;
  sub: string;
  slugs: string[];
};

export const BODY_SYSTEMS: BodySystem[] = [
  { key: "heart", label: "Heart", sub: "cardiovascular", slugs: ["hdl", "ldl", "tg", "apob", "hs_crp", "cholesterol", "triglyc"] },
  { key: "metabolism", label: "Metabolism", sub: "energy pathways", slugs: ["hba1c", "a1c", "glucose", "insulin"] },
  { key: "kidney", label: "Kidney", sub: "renal function", slugs: ["bun", "creatinine", "egfr"] },
  { key: "liver", label: "Liver", sub: "hepatic function", slugs: ["alt", "ast", "ggt", "bilirubin", "albumin"] },
  { key: "hormones", label: "Hormones", sub: "endocrine system", slugs: ["tsh", "estradiol", "testosterone", "cortisol", "free_t"] },
];

function matchSystem(lab: LabValue): string {
  const hay = `${(lab as { slug?: string }).slug ?? ""} ${lab.name}`.toLowerCase();
  for (const sys of BODY_SYSTEMS) {
    if (sys.slugs.some((s) => hay.includes(s))) return sys.key;
  }
  return "other";
}

export function labsForSystem(labs: LabValue[], systemKey: string): LabValue[] {
  return labs.filter((l) => matchSystem(l) === systemKey);
}

// Letter grade from the worst status present in a set of labs.
export function gradeFor(labs: LabValue[]): "A" | "B" | "C" | "—" {
  if (labs.length === 0) return "—";
  const has = (s: LabStatus) => labs.some((l) => (l.status ?? "optimal") === s);
  if (has("high") || has("abnormal")) return "C";
  if (has("low")) return "B";
  return "A";
}

export function gradeMeta(grade: string): { text: string; border: string; bg: string } {
  if (grade === "A")
    return { text: "text-emerald-400", border: "border-emerald-500", bg: "bg-emerald-900/20" };
  if (grade === "B")
    return { text: "text-amber-500", border: "border-amber-900/50", bg: "bg-amber-900/20" };
  if (grade === "C")
    return { text: "text-pink-400", border: "border-pink-900/50", bg: "bg-pink-900/20" };
  return { text: "text-zinc-400", border: "border-zinc-700", bg: "bg-zinc-800/50" };
}
