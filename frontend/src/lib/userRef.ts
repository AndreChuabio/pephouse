// The Junction `client_user_id` for the active user. With real auth this is the
// Supabase user id (stable across the anonymous -> Google upgrade). Until the
// session resolves we fall back to a per-browser localStorage UUID so nothing
// that reads the ref during first paint hard-crashes.

const KEY = "pephouse_user_ref";

// Set by AuthProvider once the Supabase session is known. null means "not ready
// yet" and callers get the legacy localStorage id instead.
let cachedUserRef: string | null = null;

/** Update the cached user id. AuthProvider calls this from onAuthStateChange. */
export function setUserRef(ref: string | null): void {
  cachedUserRef = ref;
}

/** The current user id: the Supabase session id when available, else a stable
 * per-browser fallback. */
export function getUserRef(): string {
  if (cachedUserRef) return cachedUserRef;
  let ref = localStorage.getItem(KEY);
  if (ref === null) {
    ref = `pephouse-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, ref);
  }
  return ref;
}
