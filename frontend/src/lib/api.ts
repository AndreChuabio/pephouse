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
    const detail = await res.text();
    throw new Error(detail || `module generation failed (${res.status})`);
  }
  return res.json() as Promise<GenerateModuleResult>;
}
