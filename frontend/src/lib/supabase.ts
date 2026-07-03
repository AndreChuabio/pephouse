import { createClient } from "@supabase/supabase-js";

// Configuration is sourced from the environment so no publishable key ships in
// source. For local dev put VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in
// frontend/.env.local; on Vercel set the same two variables. The publishable
// (anon) key is public-safe -- public-read RLS protects the data.
const url = import.meta.env.VITE_SUPABASE_URL;
// VITE_SUPABASE_PUBLISHABLE_KEY is accepted as a legacy alias for the anon key.
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the environment.",
  );
}

// A single client instance is shared for data access and auth. Session
// persistence and token refresh are on so the anonymous (and later Google)
// identity survives reloads; detectSessionInUrl completes the OAuth redirect.
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
