import { useEffect, useState } from "react";
import { fetchCompoundData, type SimulationDataResponse } from "../lib/api";
import type { CompoundRegistry } from "./useCompoundRegistry";

export type CompoundDataState = {
  bundles: Record<string, SimulationDataResponse>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
};

export function useCompoundData(
  compoundSlugs: string[],
  registry: CompoundRegistry,
): CompoundDataState {
  const [state, setState] = useState<CompoundDataState>({
    bundles: {},
    loading: {},
    errors: {},
  });

  useEffect(() => {
    if (!registry.loaded) return;
    let cancelled = false;

    const toFetch: { slug: string; id: number }[] = [];
    const unknownSlugs: string[] = [];
    for (const slug of compoundSlugs) {
      const entry = registry.bySlug[slug];
      if (!entry) {
        if (!state.errors[slug]) unknownSlugs.push(slug);
        continue;
      }
      if (state.bundles[slug] || state.loading[slug] || state.errors[slug]) continue;
      toFetch.push({ slug, id: entry.id });
    }

    if (toFetch.length === 0 && unknownSlugs.length === 0) return;

    if (unknownSlugs.length > 0) {
      setState((s) => {
        const errors = { ...s.errors };
        for (const slug of unknownSlugs) errors[slug] = "compound not in backend registry";
        return { ...s, errors };
      });
    }

    if (toFetch.length === 0) return;

    setState((s) => {
      const loading = { ...s.loading };
      for (const t of toFetch) loading[t.slug] = true;
      return { ...s, loading };
    });

    Promise.all(
      toFetch.map(({ slug, id }) =>
        fetchCompoundData(id)
          .then((data) => ({ slug, ok: true as const, data }))
          .catch((err: unknown) => ({
            slug,
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setState((s) => {
        const bundles = { ...s.bundles };
        const loading = { ...s.loading };
        const errors = { ...s.errors };
        for (const r of results) {
          delete loading[r.slug];
          if (r.ok) bundles[r.slug] = r.data;
          else {
            errors[r.slug] = r.error;
            console.error(`[useCompoundData] ${r.slug} failed:`, r.error);
          }
        }
        return { bundles, loading, errors };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [compoundSlugs, registry]);

  return state;
}
