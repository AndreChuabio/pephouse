import { useEffect, useState } from "react";
import { fetchCompoundModules, type SyntheaModuleRow } from "../lib/api";
import type { CompoundRegistry } from "./useCompoundRegistry";

export type CompoundModulesState = {
  bySlug: Record<string, SyntheaModuleRow[]>;
  loading: Record<string, boolean>;
};

export function useCompoundModules(
  compoundSlugs: string[],
  registry: CompoundRegistry,
): CompoundModulesState {
  const [state, setState] = useState<CompoundModulesState>({ bySlug: {}, loading: {} });

  useEffect(() => {
    if (!registry.loaded) return;
    let cancelled = false;

    const toFetch = compoundSlugs.filter(
      (slug) => registry.bySlug[slug] && !state.bySlug[slug] && !state.loading[slug],
    );
    if (toFetch.length === 0) return;

    setState((s) => {
      const loading = { ...s.loading };
      for (const slug of toFetch) loading[slug] = true;
      return { ...s, loading };
    });

    Promise.all(
      toFetch.map(async (slug) => {
        const entry = registry.bySlug[slug];
        if (!entry) return [slug, [] as SyntheaModuleRow[]] as const;
        try {
          const rows = await fetchCompoundModules(entry.id);
          return [slug, rows] as const;
        } catch (e) {
          console.error(`[useCompoundModules] ${slug} failed:`, e);
          return [slug, [] as SyntheaModuleRow[]] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setState((s) => {
        const bySlug = { ...s.bySlug };
        const loading = { ...s.loading };
        for (const [slug, rows] of results) {
          bySlug[slug] = rows;
          delete loading[slug];
        }
        return { bySlug, loading };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [compoundSlugs, registry]);

  return state;
}
