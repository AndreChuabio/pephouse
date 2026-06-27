import { createClient } from "@supabase/supabase-js";

// Publishable key — safe to ship to the browser; public-read RLS protects the data.
// Override via VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (e.g. on Vercel) if keys rotate.
const url =
  import.meta.env.VITE_SUPABASE_URL ?? "https://aglgyphihqcconivmmux.supabase.co";
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_xucG6ZTjpljezScUzmLxwg_xiLGP-hM";

export const supabase = createClient(url, key);
