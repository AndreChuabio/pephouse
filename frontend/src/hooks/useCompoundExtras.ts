import { useEffect, useState } from "react";
import { fetchCompoundData } from "../lib/api";

export type CompoundVendor = {
  name: string;
  url: string | null;
  costPerVial: number | null;
  tested: boolean;
};

export type CompoundExtras = {
  dose: string | null;
  vendors: CompoundVendor[];
};

/** Pull dosage (case_studies.typical_dose) + purchase links (vendors) for a set
 * of registry compound ids, reusing Simulation 2's /compounds/{id}/data. */
export function useCompoundExtras(realIds: number[]) {
  const [extras, setExtras] = useState<Record<number, CompoundExtras>>({});

  const key = realIds.slice().sort((a, b) => a - b).join(",");
  useEffect(() => {
    let alive = true;
    const missing = realIds.filter((id) => !(id in extras));
    if (!missing.length) return;
    Promise.all(
      missing.map(async (id) => {
        try {
          const data = await fetchCompoundData(id);
          const tables = data.tables ?? {};
          const cases = (tables.case_studies ?? []) as Array<Record<string, unknown>>;
          const dose =
            (cases.find((c) => c.typical_dose)?.typical_dose as string | undefined) ?? null;
          const vendorRows = (tables.vendors ?? []) as Array<Record<string, unknown>>;
          const vendors: CompoundVendor[] = vendorRows
            .filter((v) => v.source_url)
            .slice(0, 3)
            .map((v) => ({
              name: String(v.name ?? "vendor"),
              url: (v.source_url as string) ?? null,
              costPerVial: typeof v.cost_per_vial_usd === "number" ? v.cost_per_vial_usd : null,
              tested: Boolean(v.third_party_tested),
            }));
          return [id, { dose, vendors }] as [number, CompoundExtras];
        } catch {
          return [id, { dose: null, vendors: [] }] as [number, CompoundExtras];
        }
      }),
    ).then((pairs) => {
      if (!alive) return;
      setExtras((prev) => {
        const next = { ...prev };
        for (const [id, ex] of pairs) next[id] = ex;
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return extras;
}
