import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { getUserRef, setUserRef } from "../lib/userRef";

interface AuthContextValue {
  /** Stable user id (Supabase session id), preserved across the anon -> Google upgrade. */
  userRef: string;
  /** True while the user is on an anonymous session (no linked provider yet). */
  isAnonymous: boolean;
  /** Link Google to the current anonymous user, or sign in with Google outright. */
  signInWithGoogle: () => Promise<void>;
  /** Sign out; the app drops back to a fresh anonymous session. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthState {
  userRef: string;
  isAnonymous: boolean;
}

interface AuthProviderProps {
  children: ReactNode;
}

/** Resolves the Supabase session on mount, signing in anonymously when none
 * exists, and keeps the cached user id fresh via onAuthStateChange. Children
 * render only once a session is ready. */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState | null>(null);
  // Mirror of state for callbacks that must read the latest value without a
  // stale closure.
  const stateRef = useRef<AuthState | null>(null);

  const applyFallback = useCallback((): void => {
    // Supabase auth is unavailable (anonymous sign-ins not enabled on the
    // project, or a network/config error). Degrade to the per-browser
    // localStorage id so the app still renders and works, instead of hanging
    // on the loader forever. A real session, if one arrives later, overrides.
    const ref = getUserRef();
    const next: AuthState = { userRef: ref, isAnonymous: true };
    stateRef.current = next;
    setState(next);
  }, []);

  const startAnonymous = useCallback(async (): Promise<void> => {
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) applyFallback();
    } catch {
      applyFallback();
    }
  }, [applyFallback]);

  const applySession = useCallback(
    (session: Session | null): void => {
      if (!session) {
        setUserRef(null);
        stateRef.current = null;
        setState(null);
        // Anonymous-first: with no session, mint a new anonymous one. The
        // resulting SIGNED_IN event flows back through onAuthStateChange; on
        // failure startAnonymous degrades to the localStorage fallback.
        void startAnonymous();
        return;
      }
      const next: AuthState = {
        userRef: session.user.id,
        isAnonymous: session.user.is_anonymous ?? false,
      };
      setUserRef(next.userRef);
      stateRef.current = next;
      setState(next);
    },
    [startAnonymous],
  );

  useEffect(() => {
    let active = true;

    async function init(): Promise<void> {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data.session) {
          applySession(data.session);
        } else {
          // No session yet: start an anonymous one. onAuthStateChange delivers
          // it; on failure we fall back so the app never hangs.
          await startAnonymous();
        }
      } catch {
        if (active) applyFallback();
      }
    }

    void init();

    // Safety net: if nothing resolves shortly (a stalled auth call), degrade to
    // the fallback so the loader cannot hang indefinitely.
    const guard = window.setTimeout(() => {
      if (active && stateRef.current === null) applyFallback();
    }, 4000);

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session);
    });

    return () => {
      active = false;
      window.clearTimeout(guard);
      sub.subscription.unsubscribe();
    };
  }, [applySession, startAnonymous, applyFallback]);

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    const redirectTo = window.location.origin;
    const current = stateRef.current;
    if (current?.isAnonymous) {
      // Link so the existing uid (and its data) carries over to Google.
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  if (!state) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0a0a0c]">
        <div className="h-6 w-6 rounded-full border-2 border-zinc-700 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  const value: AuthContextValue = {
    userRef: state.userRef,
    isAnonymous: state.isAnonymous,
    signInWithGoogle,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the resolved auth session. Must be used within AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return ctx;
}
