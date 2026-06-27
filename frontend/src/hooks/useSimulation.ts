import { useCallback, useState } from "react";
import { postSimulate } from "../lib/api";
import type { SimulateResponse } from "../types/simulation";

export function useSimulation() {
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      compoundId: number | number[],
      patient: { age: number; sex: "M" | "F"; weightKg: number },
      options?: { sourceType?: string; liveCohort?: boolean; nDraws?: number; tiers?: string[] },
    ) => {
      setLoading(true);
      setError(null);
      try {
        const ids = Array.isArray(compoundId) ? compoundId : [compoundId];
        const data = await postSimulate({
          compounds: ids.map((id) => ({ compound_id: id })),
          patient: {
            age: patient.age,
            sex: patient.sex,
            weight_kg: patient.weightKg,
          },
          outcomes: ["weight_change_pct"],
          n_draws: options?.nDraws ?? 5000,
          seed: 42,
          source_type: options?.sourceType || undefined,
          live_cohort: options?.liveCohort ?? false,
          tiers: options?.tiers && options.tiers.length ? options.tiers : undefined,
        });
        setResult(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Simulation failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { result, loading, error, run };
}
