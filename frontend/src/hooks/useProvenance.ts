import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { ProvenanceSource } from "../types/simulation";

// Real model sources: tier-1 trials (evidence) + Reddit anecdotes, kept visually distinct.
export function useProvenance() {
  const [sources, setSources] = useState<ProvenanceSource[] | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: trials }, { data: anecdotes }] = await Promise.all([
        supabase
          .from("trials")
          .select("nct_id,phase,indication")
          .eq("tier", "tier1_evidence")
          .not("nct_id", "is", null)
          .limit(4),
        supabase.from("anecdotes").select("source,claimed_effect").limit(3),
      ]);

      const trialRows: ProvenanceSource[] = (trials ?? []).map((r, i) => ({
        id: `trial-${r.nct_id}-${i}`,
        icon: "solar:document-text-linear",
        label: `ClinicalTrials.gov (${r.nct_id})`,
        meta: r.phase ?? "trial",
        tier: "trial",
      }));

      const anecdoteRows: ProvenanceSource[] = (anecdotes ?? []).map((r, i) => ({
        id: `anecdote-${i}`,
        icon: "solar:chat-round-line-linear",
        label: `Reddit (${r.source})`,
        meta: "anecdote",
        tier: "anecdotal",
      }));

      setSources([...trialRows, ...anecdoteRows]);
    })();
  }, []);

  return { sources };
}
