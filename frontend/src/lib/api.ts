import type {
  ImportPatch,
  SimulateRequest,
  SimulateResponse,
} from "../types/simulation";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

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
