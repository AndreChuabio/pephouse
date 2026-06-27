import { useEffect, useState } from "react";
import { fetchCompounds, type RegistryCompound } from "../lib/api";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export type CompoundRegistry = {
  bySlug: Record<string, RegistryCompound>;
  loaded: boolean;
  error: string | null;
};

export function useCompoundRegistry(): CompoundRegistry {
  const [state, setState] = useState<CompoundRegistry>({ bySlug: {}, loaded: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchCompounds()
      .then((rows) => {
        if (cancelled) return;
        const bySlug: Record<string, RegistryCompound> = {};
        for (const c of rows) {
          // Primary name slug only — keying by aliases too would duplicate compounds in the list.
          bySlug[slugify(c.name)] = c;
        }
        setState({ bySlug, loaded: true, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ bySlug: {}, loaded: true, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
