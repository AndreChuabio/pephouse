import type { SimulationDataResponse } from "../lib/api";
import type { StudyRef } from "./simulation2";

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

// Keep in sync with backend/evidence.py:_evidence_sources.
const TABLES_BY_UI_TIER: Record<1 | 2 | 3 | 4, string[]> = {
  4: ["trials", "outcome_priors"],
  3: ["research_papers"],
  2: ["vendor_lab_results", "sourcing"],
  1: ["anecdotes"],
};

function trialToStudy(row: Row): StudyRef {
  const nct = str(row.nct_id);
  const phase = str(row.phase);
  const indication = str(row.indication);
  const n = num(row.n_enrolled);
  const status = str(row.status);
  const url = str(row.source_url);
  return {
    title: indication ?? nct ?? "Trial",
    meta: [nct, phase, n !== undefined ? `N=${n}` : null, status].filter(Boolean).join(" · ") || undefined,
    url,
  };
}

function paperToStudy(row: Row): StudyRef {
  const title = str(row.title) ?? "Paper";
  const journal = str(row.journal);
  const year = num(row.year);
  const url = str(row.url);
  const narrative = bool(row.is_narrative);
  return {
    title,
    meta: [journal, year !== undefined ? String(year) : null, narrative ? "review" : null]
      .filter(Boolean)
      .join(" · ") || undefined,
    url,
  };
}

function anecdoteToStudy(row: Row): StudyRef {
  const claimed = str(row.claimed_effect);
  const body = str(row.body);
  const sentiment = str(row.sentiment);
  const dose = str(row.dose_mentioned);
  const url = str(row.permalink);
  return {
    title: claimed ?? (body ? `${body.slice(0, 80)}${body.length > 80 ? "…" : ""}` : "Forum post"),
    meta: [sentiment, dose].filter(Boolean).join(" · ") || undefined,
    url,
  };
}

function labToStudy(row: Row): StudyRef {
  const vendor = str(row.vendor_name);
  const lab = str(row.test_lab);
  const purity = num(row.purity_pct);
  const tested = num(row.tested_mg);
  const labeled = num(row.label_mg);
  const url = str(row.source_url);
  return {
    title: vendor ? `${vendor} lab test` : "Vendor lab test",
    meta: [
      lab,
      purity !== undefined ? `${purity}% pure` : null,
      tested !== undefined && labeled !== undefined ? `${tested}/${labeled}mg` : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
    url,
  };
}

function caseStudyToStudy(row: Row): StudyRef {
  const cluster = str(row.cluster_label);
  const reported = str(row.reported_effect);
  const n = num(row.n);
  const conf = num(row.confidence);
  return {
    title: cluster ?? reported ?? "Case cluster",
    meta: [
      reported && cluster ? reported : null,
      n !== undefined ? `n=${n}` : null,
      conf !== undefined ? `conf ${conf}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
  };
}

function evidenceFactToStudy(row: Row): StudyRef {
  return {
    title: str(row.fact) ?? "Evidence fact",
    meta: undefined,
    url: str(row.source_url),
  };
}

function outcomePriorToStudy(row: Row): StudyRef {
  const outcome = str(row.outcome_name);
  const mean = num(row.effect_mean);
  const sd = num(row.effect_sd);
  const unit = str(row.unit);
  const nct = str(row.source_nct);
  const n = num(row.population_n);
  return {
    title: outcome ? `${outcome} prior` : "Outcome prior",
    meta: [
      mean !== undefined && sd !== undefined ? `${mean}±${sd}${unit ? unit : ""}` : null,
      n !== undefined ? `N=${n}` : null,
      nct,
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
    url: nct ? `https://clinicaltrials.gov/study/${nct}` : undefined,
  };
}

function rowToStudy(row: Row, table: string): StudyRef | null {
  switch (table) {
    case "trials":
      return trialToStudy(row);
    case "research_papers":
      return paperToStudy(row);
    case "anecdotes":
      return anecdoteToStudy(row);
    case "vendor_lab_results":
      return labToStudy(row);
    case "case_studies":
      return caseStudyToStudy(row);
    case "evidence_facts":
      return evidenceFactToStudy(row);
    case "outcome_priors":
      return outcomePriorToStudy(row);
    default:
      return null;
  }
}

const STUDY_LIMIT_PER_TIER = 6;

export function studiesByTier(
  bundle: SimulationDataResponse | undefined,
): Record<1 | 2 | 3 | 4, StudyRef[]> {
  const result: Record<1 | 2 | 3 | 4, StudyRef[]> = { 1: [], 2: [], 3: [], 4: [] };
  if (!bundle) return result;

  const tables = bundle.tables ?? {};
  for (const tier of [4, 3, 2, 1] as const) {
    for (const tableName of TABLES_BY_UI_TIER[tier]) {
      const rows = (tables[tableName] ?? []) as Row[];
      for (const row of rows) {
        const study = rowToStudy(row, tableName);
        if (study) result[tier].push(study);
      }
    }
    result[tier] = result[tier].slice(0, STUDY_LIMIT_PER_TIER);
  }
  return result;
}

export function studiesFromBundle(
  bundle: SimulationDataResponse | undefined,
  tier: 1 | 2 | 3 | 4,
): StudyRef[] {
  return studiesByTier(bundle)[tier];
}
