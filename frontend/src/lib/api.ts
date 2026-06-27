import type { SimulateRequest, SimulateResponse } from "../types/simulation";

// Local dev + laptop demo default to the local backend; production sets VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8001";

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
