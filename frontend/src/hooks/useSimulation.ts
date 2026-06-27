import { useCallback, useState } from "react";
import { postSimulate } from "../lib/api";
import type { SimulateResponse } from "../types/simulation";

export function useSimulation() {
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (compoundId: number, patient: { age: number; sex: "M" | "F"; weightKg: number }) => {
      setLoading(true);
      setError(null);
      try {
        const data = await postSimulate({
          compounds: [{ compound_id: compoundId }],
          patient: {
            age: patient.age,
            sex: patient.sex,
            weight_kg: patient.weightKg,
          },
          outcomes: ["weight_change_pct"],
          n_draws: 5000,
          seed: 42,
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
