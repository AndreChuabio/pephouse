import type {
  ImportPatch,
  SimulateRequest,
  SimulateResponse,
} from "../types/simulation";

// Hosted backend (Railway) is the default so the deployed app works for everyone.
// For local dev against your own backend, set VITE_API_URL=http://localhost:8001 in frontend/.env.local
const API_BASE = import.meta.env.VITE_API_URL ?? "https://pephouse-backend-production.up.railway.app";

export async function postSimulate(body: SimulateRequest): Promise<SimulateResponse> {
  const res = await fetch(`${API_BASE}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `simulate failed (${res.status})`);
  }
  return res.json() as Promise<SimulateResponse>;
}

export type GenerateModuleResult = {
  compound_id: number;
  generated: number;
  modules: { id: number; name: string; outcome_name: string }[];
};

export async function postGenerateModule(compoundId: number): Promise<GenerateModuleResult> {
  const res = await fetch(`${API_BASE}/compounds/${compoundId}/module`, { method: "POST" });
  if (!res.ok) {
    let detail = `module generation failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body; keep the default
    }
    throw new Error(detail);
  }
  return res.json() as Promise<GenerateModuleResult>;
}

export type RegistryCompound = {
  id: number;
  name: string;
  aliases?: string[];
  drug_class?: string | null;
  fda_status?: string | null;
  approved?: boolean;
  summary?: string | null;
};

export async function fetchCompounds(): Promise<RegistryCompound[]> {
  const res = await fetch(`${API_BASE}/compounds`);
  if (!res.ok) throw new Error(`compounds failed (${res.status})`);
  return res.json() as Promise<RegistryCompound[]>;
}

export type EvidenceSourceRow = {
  id: string;
  label: string;
  data_tier: string;
  display_tier: number;
  count: number;
  available: boolean;
};

export type SimulationDataResponse = {
  compound_id: number;
  name: string;
  drug_class: string | null;
  fda_status: string | null;
  approved: boolean;
  summary: string | null;
  evidence_sources: EvidenceSourceRow[];
  outcome_names: string[];
  studied_age_min: number | null;
  studied_age_max: number | null;
  cohort_total: number;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export async function fetchCompoundData(compoundId: number): Promise<SimulationDataResponse> {
  const res = await fetch(`${API_BASE}/compounds/${compoundId}/data`);
  if (!res.ok) throw new Error(`compound data failed (${res.status})`);
  return res.json() as Promise<SimulationDataResponse>;
}

// ---- Patient data import (Junction) ----

// The backend ProfilePatch is snake_case; the frontend uses camelCase weightKg.
type RawPatch = {
  age?: number | null;
  sex?: "M" | "F" | null;
  weight_kg?: number | null;
  conditions?: string[];
  labs?: ImportPatch["labs"];
  source: ImportPatch["source"];
};

function toPatch(raw: RawPatch): ImportPatch {
  return {
    ...(raw.age != null ? { age: raw.age } : {}),
    ...(raw.sex ? { sex: raw.sex } : {}),
    ...(raw.weight_kg != null ? { weightKg: raw.weight_kg } : {}),
    conditions: raw.conditions ?? [],
    labs: raw.labs ?? [],
    source: raw.source,
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.text()) || `${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** Start a Junction Link session; returns the hosted URL to open. */
export async function importLink(userRef: string): Promise<{ link_url: string }> {
  const res = await fetch(`${API_BASE}/import/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_ref: userRef }),
  });
  if (!res.ok) throw new Error((await res.text()) || `link failed (${res.status})`);
  return res.json() as Promise<{ link_url: string }>;
}

/** Poll target: once a provider is linked, returns the profile/body patch. */
export async function importProfile(
  userRef: string,
): Promise<{ connected: boolean; patch: ImportPatch | null }> {
  const data = await getJson<{ connected: boolean; patch: RawPatch | null }>(
    `/import/profile?user_ref=${encodeURIComponent(userRef)}`,
  );
  return { connected: data.connected, patch: data.patch ? toPatch(data.patch) : null };
}

/** Pull the demo lab order's biomarkers + derived conditions. */
export async function importLabs(userRef: string): Promise<ImportPatch> {
  const raw = await getJson<RawPatch>(
    `/import/labs?user_ref=${encodeURIComponent(userRef)}`,
  );
  return toPatch(raw);
}
