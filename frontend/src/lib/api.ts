import type { SimulateRequest, SimulateResponse } from "../types/simulation";

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
