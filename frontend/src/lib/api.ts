import type {
  ImportPatch,
  SimulateRequest,
  SimulateResponse,
} from "../types/simulation";

// Hosted backend (Railway) is the default so the deployed app works for everyone.
// For local dev against your own backend, set VITE_API_URL=http://localhost:8001 in frontend/.env.local
const API_BASE = import.meta.env.VITE_API_URL ?? "https://pephouse-backend-production.up.railway.app";

/** Digital Twin one-shot run: full payload (patient/user_ref + compounds + controls). */
export type TwinSimulatePayload = {
  user_ref?: string;
  patient?: { age: number; sex: "M" | "F"; weight_kg: number; conditions?: string[] };
  compounds: number[];
  outcomes?: string[];
  tiers?: string[];
  source_type?: string;
  n_draws?: number;
  seed?: number;
};

export async function twinSimulate(payload: TwinSimulatePayload): Promise<SimulateResponse> {
  const res = await fetch(`${API_BASE}/twin/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || `twin simulate failed (${res.status})`);
  return res.json() as Promise<SimulateResponse>;
}

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

export type InteractionSeverity = "major" | "moderate" | "minor" | "unknown";

export type InteractionPair = {
  compound_a_id: number;
  compound_a_name: string;
  compound_b_id: number;
  compound_b_name: string;
  severity: InteractionSeverity;
  mechanism: string | null;
  management: string | null;
  source_url: string | null;
  source_kind: "drugbank_pubchem" | "curated" | "no_data";
};

export type InteractionsResponse = {
  pairs: InteractionPair[];
};

export type SyntheaState = {
  type: string;
  direct_transition?: string;
  distributed_transition?: { transition: string; distribution: number }[];
  conditional_transition?: { transition: string; condition?: Record<string, unknown> }[];
  complex_transition?: Record<string, unknown>[];
  category?: string;
  codes?: { system: string; code: string; display?: string }[];
  unit?: string;
  range?: { low?: number; high?: number };
  exact?: { quantity?: number };
  encounter_class?: string;
  reason?: string;
  allow?: {
    condition_type?: string;
    conditions?: Array<{ condition_type?: string; operator?: string; quantity?: number; unit?: string }>;
  };
};

export type SyntheaModuleRow = {
  id: number;
  name: string;
  outcome_name: string;
  compound_id: number;
  active: boolean;
  source?: string;
  eligibility?: Record<string, unknown>;
  created_at?: string;
  module: {
    name: string;
    states: Record<string, SyntheaState>;
    remarks?: string[];
  };
};

export async function fetchCompoundModules(compoundId: number): Promise<SyntheaModuleRow[]> {
  const res = await fetch(`${API_BASE}/compounds/${compoundId}/modules`);
  if (!res.ok) throw new Error(`modules failed (${res.status})`);
  return res.json() as Promise<SyntheaModuleRow[]>;
}

export async function fetchInteractions(compoundIds: number[]): Promise<InteractionsResponse> {
  if (compoundIds.length < 2) return { pairs: [] };
  const qs = compoundIds.join(",");
  const res = await fetch(`${API_BASE}/interactions?ids=${qs}`);
  if (!res.ok) throw new Error(`interactions failed (${res.status})`);
  return res.json() as Promise<InteractionsResponse>;
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

export type WearableMetrics = {
  sleep_hours: number | null;
  steps: number | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  calories: number | null;
};

export type WearableResult = {
  metrics: WearableMetrics;
  mocked: boolean;
  source: ImportPatch["source"];
};

/** Pull recent wearable metrics (sleep / steps / resting HR / HRV). */
export async function importWearable(userRef: string): Promise<WearableResult> {
  return getJson<WearableResult>(`/import/wearable?user_ref=${encodeURIComponent(userRef)}`);
}

// ---- User-data store (GET/POST /users/{user_ref}/data) ----

export type UserDataBundle = {
  user_ref: string;
  connected: boolean;
  age?: number | null;
  sex?: "M" | "F" | null;
  weight_kg?: number | null;
  conditions: string[];
  goals: string[];
  source?: ImportPatch["source"] | null;
  labs: ImportPatch["labs"];
  wearable: Array<Record<string, unknown>>;
};

/** Fetch the stored bundle for a user, or null if nothing saved yet (404). */
export async function fetchUserData(userRef: string): Promise<UserDataBundle | null> {
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userRef)}/data`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error((await res.text()) || `user data failed (${res.status})`);
  return res.json() as Promise<UserDataBundle>;
}

/** Persist a connected/reported patch (camelCase weightKg -> snake weight_kg).
 *
 * `labs` is only sent when explicitly provided — the backend fully replaces
 * stored labs when the key is present, so a profile-only edit (age/sex/weight)
 * must omit it or it would wipe the user's biomarkers. */
export async function saveUserData(
  userRef: string,
  patch: Partial<ImportPatch> & { goals?: string[] },
): Promise<UserDataBundle> {
  const body: Record<string, unknown> = {};
  if (patch.conditions !== undefined) body.conditions = patch.conditions;
  if (patch.goals !== undefined) body.goals = patch.goals;
  if (patch.age != null) body.age = patch.age;
  if (patch.sex) body.sex = patch.sex;
  if (patch.weightKg != null) body.weight_kg = patch.weightKg;
  if (patch.labs !== undefined) body.labs = patch.labs;
  if (patch.source) body.source = patch.source;
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userRef)}/data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `save user data failed (${res.status})`);
  return res.json() as Promise<UserDataBundle>;
}
