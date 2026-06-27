import { useEffect, useState } from "react";
import { fetchInteractions, type InteractionPair } from "../lib/api";

export type InteractionsState = {
  pairs: InteractionPair[];
  loading: boolean;
  error: string | null;
};

export function useInteractions(compoundBackendIds: number[]): InteractionsState {
  const [state, setState] = useState<InteractionsState>({ pairs: [], loading: false, error: null });

  const key = compoundBackendIds.slice().sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (compoundBackendIds.length < 2) {
      setState({ pairs: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchInteractions(compoundBackendIds)
      .then((data) => {
        if (cancelled) return;
        setState({ pairs: data.pairs, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[useInteractions] failed:", msg);
        setState({ pairs: [], loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
    // key collapses the array to a stable dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
