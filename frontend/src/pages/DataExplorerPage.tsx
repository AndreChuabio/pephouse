import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { postGenerateModule } from "../lib/api";
import { supabase } from "../lib/supabase";

type Compound = {
  id: number;
  name: string;
  drug_class: string | null;
  fda_status: string | null;
  approved: boolean;
  summary: string | null;
};

type Detail = {
  priors: any[];
  caseStudies: any[];
  trials: any[];
  anecdotes: any[];
  papers: any[];
  sourcing: any[];
  sourcePriors: any[];
  labResults: any[];
  vendors: any[];
  runs: any[];
  modules: any[];
};

const SOURCE_LABEL: Record<string, string> = {
  compounding_pharmacy: "Compounding pharmacy",
  vendor_tested: "Gray-market, lab-tested",
  gray_market: "Gray-market, untested",
  research_chem: "Research chemical",
  brand: "Brand / pharma-grade",
};
const SOURCE_TONE: Record<string, "green" | "orange" | "zinc"> = {
  compounding_pharmacy: "green",
  brand: "green",
  vendor_tested: "orange",
  gray_market: "orange",
  research_chem: "zinc",
};

function Badge({ tone, children }: { tone: "green" | "orange" | "zinc"; children: React.ReactNode }) {
  const map = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    zinc: "bg-zinc-800 text-zinc-400 border-zinc-700",
  } as const;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider ${map[tone]}`}>
      {children}
    </span>
  );
}

function Section({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest mb-3 flex items-center gap-2">
        <Icon icon={icon} className="text-zinc-500" /> {title}
        <span className="text-zinc-600">({count})</span>
      </h3>
      {count === 0 ? <p className="text-xs text-zinc-600 italic">none in the database</p> : children}
    </div>
  );
}

export default function DataExplorerPage() {
  useDocumentTitle("PepHouse | Database Explorer");
  const [compounds, setCompounds] = useState<Compound[]>([]);
  const [selected, setSelected] = useState<Compound | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [refreshKey, setRefreshKey] = useState(0);
  const [genState, setGenState] = useState<"idle" | "loading">("idle");
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerateModule = async () => {
    if (!selected) return;
    setGenState("loading");
    setGenError(null);
    try {
      await postGenerateModule(selected.id);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenState("idle");
    }
  };

  useEffect(() => {
    supabase
      .from("compounds")
      .select("id,name,drug_class,fda_status,approved,summary")
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Compound[];
        setCompounds(list);
        if (list.length) setSelected(list[0]);
      });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setGenError(null);
    const id = selected.id;
    Promise.all([
      supabase.from("outcome_priors").select("outcome_name,effect_mean,effect_sd,unit,population_n,source_nct,dispersion_basis").eq("compound_id", id),
      supabase.from("case_studies").select("cluster_label,evidence_basis,n,confidence,trial_backed").eq("compound_id", id),
      supabase.from("trials").select("nct_id,phase,indication,status,n_enrolled,source_url,matched_intervention").eq("compound_id", id).limit(25),
      supabase.from("anecdotes").select("body,claimed_effect,sentiment,permalink,dose_mentioned").eq("compound_id", id),
      supabase.from("research_papers").select("title,journal,year,is_narrative,url").eq("compound_id", id),
      supabase.from("sourcing").select("vendor_name,origin_country,notes,source_url").eq("compound_id", id),
      supabase.from("source_potency_priors").select("source_type,potency_mean,potency_sd,p_fail,p_contam,quantity_variance_p95,compound_id,basis").or(`compound_id.eq.${id},compound_id.is.null`),
      supabase.from("vendor_lab_results").select("vendor_name,purity_pct,label_mg,tested_mg,quantity_variance_pct,potency_factor,test_lab,failed").eq("compound_id", id),
      supabase.from("vendors").select("*").order("reliability_score", { ascending: false }),
      supabase.from("simulation_runs").select("id,created_at,source_type,live_cohort,cohort_source,cohort_n,cohort_gen_ms,data_confidence,outcomes").eq("compound_id", id).order("created_at", { ascending: false }).limit(10),
      supabase.from("synthea_modules").select("id,created_at,name,outcome_name,eligibility,source").eq("compound_id", id).order("created_at", { ascending: false }).limit(10),
    ]).then(([p, cs, t, a, rp, s, sp, lr, v, runs, mods]) => {
      // prefer compound-specific prior over the NULL default, per source_type
      const bySource: Record<string, any> = {};
      for (const row of (sp.data ?? [])) {
        const cur = bySource[row.source_type];
        if (!cur || (row.compound_id && !cur.compound_id)) bySource[row.source_type] = row;
      }
      const order = ["compounding_pharmacy", "vendor_tested", "gray_market", "research_chem", "brand"];
      setDetail({
        priors: p.data ?? [],
        caseStudies: cs.data ?? [],
        trials: t.data ?? [],
        anecdotes: a.data ?? [],
        papers: rp.data ?? [],
        sourcing: s.data ?? [],
        sourcePriors: order.map((k) => bySource[k]).filter(Boolean),
        labResults: lr.data ?? [],
        vendors: v.data ?? [],
        runs: runs.data ?? [],
        modules: mods.data ?? [],
      });
      setLoading(false);
    });
  }, [selected, refreshKey]);

  return (
    <AppShell>
      <div className="h-16 flex items-center px-8 border-b border-zinc-800/60 shrink-0 z-10">
        <h1 className="text-sm font-medium text-white tracking-tight flex items-center gap-2">
          <Icon icon="solar:database-linear" className="text-blue-500" /> Database Explorer
        </h1>
        <span className="ml-3 text-xs text-zinc-500">live from Supabase &mdash; click a compound</span>
      </div>

      <div className="flex-1 overflow-hidden flex z-10">
        {/* compound list */}
        <div className="w-64 border-r border-zinc-800/60 overflow-y-auto shrink-0">
          {compounds.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className={`w-full text-left px-4 py-3 border-b border-zinc-800/40 transition-colors ${
                selected?.id === c.id ? "bg-zinc-800/50" : "hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-200">{c.name}</span>
                <Badge tone={c.approved ? "green" : "orange"}>{c.approved ? "FDA" : "Gray"}</Badge>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{c.drug_class}</p>
            </button>
          ))}
        </div>

        {/* detail */}
        <div className="flex-1 overflow-y-auto p-8">
          {!selected ? (
            <p className="text-zinc-500">Loading compounds&hellip;</p>
          ) : (
            <div className="max-w-4xl space-y-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-semibold text-white">{selected.name}</h2>
                  <Badge tone={selected.approved ? "green" : "orange"}>{selected.fda_status ?? (selected.approved ? "approved" : "research")}</Badge>
                </div>
                <p className="text-sm text-zinc-400 mt-1">{selected.drug_class}</p>
                <p className="text-sm text-zinc-500 mt-2">{selected.summary}</p>
              </div>

              {loading || !detail ? (
                <p className="text-zinc-500 text-sm">Loading data&hellip;</p>
              ) : (
                <>
                  <Section icon="solar:history-2-linear" title="Recent Simulations" count={detail.runs.length}>
                    {detail.runs.length === 0 ? (
                      <p className="text-xs text-zinc-600">No runs yet &mdash; run this compound in the Simulation Arena.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.runs.map((r) => {
                          const o = (r.outcomes && r.outcomes[0]) || null;
                          return (
                            <div key={r.id} className="flex items-center justify-between text-sm bg-zinc-950/50 rounded px-3 py-2">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="text-zinc-600 text-xs font-mono">#{r.id}</span>
                                {r.source_type ? (
                                  <Badge tone={SOURCE_TONE[r.source_type] ?? "zinc"}>{SOURCE_LABEL[r.source_type] ?? r.source_type}</Badge>
                                ) : (
                                  <span className="text-xs text-zinc-500">label dose</span>
                                )}
                                <span className="text-xs text-zinc-500 truncate">
                                  {r.cohort_source === "synthea_live"
                                    ? `Synthea live · ${r.cohort_n} in ${r.cohort_gen_ms}ms`
                                    : `cohort ${r.cohort_n}`}
                                </span>
                              </span>
                              <span className="font-mono text-xs text-zinc-400 shrink-0">
                                {o && o.distribution_void ? (
                                  <span className="text-orange-400">void</span>
                                ) : o && o.p50 != null ? (
                                  <>
                                    p50 {o.p50}%
                                    {o.source_dud_pct ? <span className="text-orange-400"> &middot; {o.source_dud_pct}% dud</span> : null}
                                  </>
                                ) : null}
                                <span className="text-zinc-600"> &middot; {r.data_confidence}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>

                  <div className="bg-zinc-900/30 border border-zinc-800/60 rounded-lg p-4">
                    <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-widest mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Icon icon="solar:box-minimalistic-linear" className="text-zinc-500" /> Synthea Modules
                        <span className="text-zinc-600">({detail.modules.length})</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleGenerateModule}
                        disabled={genState === "loading" || detail.priors.length === 0}
                        title={detail.priors.length === 0 ? "No trial priors to build a module from" : undefined}
                        className="text-[10px] normal-case px-2.5 py-1 rounded border border-blue-500/40 text-blue-300 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {genState === "loading" ? "Generating…" : "Generate module"}
                      </button>
                    </h3>
                    <p className="text-xs text-zinc-500 mb-2">
                      Generic Modules built from this compound&apos;s priors; the newest is loaded into live cohort generation.
                    </p>
                    {detail.priors.length === 0 ? (
                      <p className="text-xs text-amber-500/80 mb-2">Anecdote-only compound &mdash; no trial priors, so there is no module to build.</p>
                    ) : genError ? (
                      <p className="text-xs text-orange-400 mb-2">{genError}</p>
                    ) : null}
                    {detail.modules.length === 0 ? (
                      detail.priors.length > 0 ? (
                        <p className="text-xs text-zinc-600">No modules yet &mdash; click Generate to build one from the priors.</p>
                      ) : null
                    ) : (
                      <div className="space-y-1.5">
                        {detail.modules.map((m) => (
                          <div key={m.id} className="flex items-center justify-between text-sm bg-zinc-950/50 rounded px-3 py-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="text-zinc-600 text-xs font-mono">#{m.id}</span>
                              <span className="text-zinc-300 truncate">{m.outcome_name}</span>
                              <Badge tone="zinc">{m.source}</Badge>
                            </span>
                            <span className="font-mono text-xs text-zinc-500 shrink-0">
                              {m.eligibility?.min_age != null || m.eligibility?.max_age != null
                                ? `age ${m.eligibility?.min_age ?? "*"}-${m.eligibility?.max_age ?? "*"}`
                                : "age 18+"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Section icon="solar:graph-new-linear" title="Seed Distribution (Monte Carlo priors)" count={detail.priors.length}>
                    <div className="space-y-2">
                      {detail.priors.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-sm bg-zinc-950/50 rounded px-3 py-2">
                          <span className="text-zinc-300">{p.outcome_name}</span>
                          <span className="font-mono text-emerald-400">
                            {p.effect_mean} &plusmn; {p.effect_sd} {p.unit} &middot; n={p.population_n}
                          </span>
                          <span className="text-xs text-zinc-600">{p.source_nct} &middot; {p.dispersion_basis}</span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon="solar:layers-linear" title="Case Studies" count={detail.caseStudies.length}>
                    <div className="space-y-1.5">
                      {detail.caseStudies.map((cs, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300 flex items-center gap-2">
                            <Badge tone={cs.trial_backed ? "green" : "orange"}>{cs.evidence_basis}</Badge>
                            {cs.cluster_label}
                          </span>
                          <span className="font-mono text-xs text-zinc-500">n={cs.n} &middot; conf {cs.confidence}</span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon="solar:document-text-linear" title="Clinical Trials" count={detail.trials.length}>
                    <div className="space-y-1.5">
                      {detail.trials.map((t, i) => (
                        <a key={i} href={t.source_url} target="_blank" rel="noreferrer" className="flex items-center justify-between text-sm hover:bg-zinc-950/60 rounded px-2 py-1.5 group">
                          <span className="text-zinc-300 group-hover:text-blue-400">{t.nct_id} <span className="text-zinc-600">&mdash; {t.indication}</span></span>
                          <span className="font-mono text-xs text-zinc-500">{t.phase} &middot; n={t.n_enrolled ?? "?"} &middot; {t.status}</span>
                        </a>
                      ))}
                    </div>
                  </Section>

                  <Section icon="solar:chat-round-line-linear" title="Reddit Anecdotes" count={detail.anecdotes.length}>
                    <div className="space-y-2">
                      {detail.anecdotes.map((a, i) => (
                        <a key={i} href={a.permalink} target="_blank" rel="noreferrer" className="block text-sm hover:bg-zinc-950/60 rounded px-2 py-1.5 group">
                          <div className="flex items-center gap-2">
                            <Badge tone="orange">{a.sentiment}</Badge>
                            <span className="text-zinc-300">{a.claimed_effect}</span>
                            {a.dose_mentioned && <span className="text-xs font-mono text-zinc-600">{a.dose_mentioned}</span>}
                          </div>
                          <p className="text-xs text-zinc-600 mt-0.5 truncate group-hover:text-zinc-500">{a.body}</p>
                        </a>
                      ))}
                    </div>
                  </Section>

                  <Section icon="solar:book-linear" title="Research Papers" count={detail.papers.length}>
                    <div className="space-y-1.5">
                      {detail.papers.map((p, i) => (
                        <a key={i} href={p.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 text-sm hover:bg-zinc-950/60 rounded px-2 py-1.5 group">
                          <span className="text-zinc-300 group-hover:text-blue-400">{p.title}</span>
                          <span className="shrink-0">
                            <Badge tone={p.is_narrative ? "zinc" : "green"}>{p.is_narrative ? "review" : "primary"}</Badge>
                            <span className="text-xs text-zinc-600 ml-1">{p.year}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  </Section>

                  <Section icon="solar:shield-warning-linear" title="Source Quality — delivered-dose variance" count={detail.sourcePriors.length}>
                    <p className="text-xs text-zinc-500 mb-3">delivered_dose = label &times; potency_factor. Where you source it shifts the curve.</p>
                    <div className="space-y-1.5">
                      {detail.sourcePriors.map((sp, i) => {
                        const k = `sp-${i}`;
                        return (
                          <div key={k} className="bg-zinc-950/50 rounded">
                            <button type="button" onClick={() => toggle(k)} className="w-full flex items-center justify-between text-sm px-3 py-2 hover:bg-zinc-900/60 rounded">
                              <span className="flex items-center gap-2">
                                <Icon icon={open[k] ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"} className="text-zinc-600 text-xs" />
                                <Badge tone={SOURCE_TONE[sp.source_type] ?? "zinc"}>{SOURCE_LABEL[sp.source_type] ?? sp.source_type}</Badge>
                              </span>
                              <span className="font-mono text-xs text-zinc-400">
                                potency {sp.potency_mean}&plusmn;{sp.potency_sd}
                                {sp.p_fail > 0 && <span className="text-orange-400"> &middot; {Math.round(sp.p_fail * 100)}% dud</span>}
                                {sp.p_contam > 0 && <span className="text-red-400"> &middot; {Math.round(sp.p_contam * 100)}% contam</span>}
                              </span>
                            </button>
                            {open[k] && (
                              <div className="px-9 pb-3 pt-1 text-xs text-zinc-500 space-y-1">
                                <p>Delivered-dose model: <span className="text-zinc-300 font-mono">label &times; {sp.potency_mean}&plusmn;{sp.potency_sd}</span>, with a {Math.round((sp.p_fail || 0) * 100)}% chance of a near-inert "dud" lot{sp.p_contam > 0 ? ` and ${Math.round(sp.p_contam * 100)}% contamination risk` : ""}.</p>
                                {sp.quantity_variance_p95 != null && <p>Quantity divergence (95th pct): <span className="text-zinc-300 font-mono">&plusmn;{Math.round(sp.quantity_variance_p95 * 100)}%</span>{sp.n_samples ? ` across ${sp.n_samples} tested samples` : ""}.</p>}
                                <p className="flex items-center gap-2">
                                  <Badge tone={sp.basis === "verified" ? "green" : "zinc"}>{sp.basis === "verified" ? "verified" : "estimate"}</Badge>
                                  <span className="text-zinc-600">{(sp.source_refs || []).find((r: string) => r.startsWith("http")) ? <a className="hover:text-blue-400" href={(sp.source_refs || []).find((r: string) => r.startsWith("http"))} target="_blank" rel="noreferrer">source &rarr;</a> : (sp.source_refs || [])[0]}</span>
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {detail.labResults.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-zinc-800/50">
                        <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1.5">measured (third-party tested)</p>
                        {detail.labResults.map((lr, i) => (
                          <div key={i} className="flex items-center justify-between text-sm py-0.5">
                            <span className="text-zinc-300">{lr.vendor_name} <span className="text-zinc-600">&middot; {lr.test_lab}</span></span>
                            <span className="font-mono text-xs text-zinc-400">
                              {lr.purity_pct}% pure, {lr.tested_mg}/{lr.label_mg}mg
                              <span className={lr.potency_factor < 0.95 ? "text-orange-400" : "text-emerald-400"}> &rarr; {lr.potency_factor}&times;</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  <Section icon="solar:shop-2-linear" title="Vendors & Sellers" count={detail.vendors.length}>
                    <div className="space-y-1.5">
                      {detail.vendors.map((v) => {
                        const k = `v-${v.id}`;
                        const labs = detail.labResults.filter((lr) => lr.vendor_name === v.name);
                        return (
                          <div key={k} className="bg-zinc-950/50 rounded">
                            <button type="button" onClick={() => toggle(k)} className="w-full flex items-center justify-between text-sm px-3 py-2 hover:bg-zinc-900/60 rounded">
                              <span className="flex items-center gap-2">
                                <Icon icon={open[k] ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"} className="text-zinc-600 text-xs" />
                                <span className="text-zinc-200">{v.name}</span>
                                <Badge tone={SOURCE_TONE[v.source_type] ?? "zinc"}>{SOURCE_LABEL[v.source_type] ?? v.source_type}</Badge>
                              </span>
                              <span className="font-mono text-xs text-zinc-500">
                                {v.finnrick_rating ? `rated ${v.finnrick_rating} · ` : ""}reliability {v.reliability_score}
                              </span>
                            </button>
                            {open[k] && (
                              <div className="px-9 pb-3 pt-1 text-xs text-zinc-400 space-y-1.5">
                                {v.manufacturer && <p>Manufacturer: <span className="text-zinc-300">{v.manufacturer}</span></p>}
                                <p>Origin: <span className="text-zinc-300">{v.country}</span> &middot; cost ~{v.cost_multiple_vs_gray}x gray-market</p>
                                <p className="flex flex-wrap gap-1.5">
                                  {v.third_party_tested && <Badge tone="green">3rd-party tested</Badge>}
                                  {v.gmp_certified && <Badge tone="green">GMP</Badge>}
                                  {v.fda_green_list && <Badge tone="green">FDA Green List</Badge>}
                                  {v.fda_dmf && <Badge tone="green">FDA DMF {v.fda_dmf}</Badge>}
                                </p>
                                {v.notes && <p className="text-zinc-500">{v.notes}</p>}
                                {labs.map((lr, j) => (
                                  <p key={j} className="font-mono text-emerald-400">measured {selected.name}: {lr.purity_pct}% pure, {lr.tested_mg}/{lr.label_mg}mg &rarr; {lr.potency_factor}&times;</p>
                                ))}
                                {v.source_url && <a className="text-blue-400 hover:underline" href={v.source_url} target="_blank" rel="noreferrer">source &rarr;</a>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  <Section icon="solar:map-point-linear" title="Sourcing" count={detail.sourcing.length}>
                    <div className="space-y-1.5">
                      {detail.sourcing.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300">{s.vendor_name}</span>
                          <span className="text-xs text-zinc-500">{s.origin_country}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
