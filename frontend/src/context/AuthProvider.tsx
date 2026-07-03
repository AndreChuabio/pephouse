import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { setUserRef } from "../lib/userRef";

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

  const applySession = useCallback((session: Session | null): void => {
    if (!session) {
      setUserRef(null);
      stateRef.current = null;
      setState(null);
      // Anonymous-first: with no session, mint a new anonymous one. The
      // resulting SIGNED_IN event flows back through onAuthStateChange.
      void supabase.auth.signInAnonymously();
      return;
    }
    const next: AuthState = {
      userRef: session.user.id,
      isAnonymous: session.user.is_anonymous ?? false,
    };
    setUserRef(next.userRef);
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let active = true;

    async function init(): Promise<void> {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) {
        applySession(data.session);
      } else {
        // No session yet: start an anonymous one. onAuthStateChange delivers it.
        await supabase.auth.signInAnonymously();
      }
    }

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession]);

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
