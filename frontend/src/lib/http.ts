import { supabase } from "./supabase";

// Hosted backend (Railway) is the default so the deployed app works for everyone.
// For local dev against your own backend, set VITE_API_URL=http://localhost:8001 in
// frontend/.env.local
export const API_BASE =
  import.meta.env.VITE_API_URL ?? "https://pephouse-backend-production.up.railway.app";

/**
 * Call the pephouse API with the caller's Supabase access token attached.
 *
 * The backend derives identity from this token: it no longer trusts a `user_ref`
 * sent in a path, query, or body, and it refuses any request whose `user_ref`
 * is not the token's own subject. Every call that touches member data therefore
 * has to go through here, or it gets a 401.
 *
 * Content-Type is left to the caller so multipart uploads keep the boundary the
 * browser generates for them.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/** apiFetch plus a JSON decode, surfacing the backend's error text on failure. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error((await res.text()) || `${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}
