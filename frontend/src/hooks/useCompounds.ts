import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Compound } from "../types/simulation";

// Real compound catalog from Supabase, mapped to the CocktailMixer view-model.
export function useCompounds() {
  const [compounds, setCompounds] = useState<Compound[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("compounds")
      .select("id,name,drug_class,fda_status,approved,summary")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        setCompounds(
          (data ?? []).map((c) => ({
            id: String(c.id),
            name: c.name,
            tier: c.approved ? "fda-approved" : "gray-market",
            description: c.drug_class ?? c.summary ?? "",
            dosage: c.approved ? "set dose" : "research use",
            dosagePercent: 50,
          })),
        );
      });
  }, []);

  return { compounds, error };
}
