import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { VendorGlobe } from "../components/data-explorer/VendorGlobe";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
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
  trials: any[];
  anecdotes: any[];
  papers: any[];
  sourcePriors: any[];
  labResults: any[];
  vendors: any[];
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

function Badge({ tone, children }: { tone: "green" | "orange" | "yellow" | "zinc"; children: React.ReactNode }) {
  const map = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    yellow: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    zinc: "bg-zinc-800 text-zinc-400 border-zinc-700",
  } as const;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider whitespace-nowrap shrink-0 ${map[tone]}`}>
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
    const id = selected.id;
    Promise.all([
      supabase.from("trials").select("nct_id,phase,indication,status,n_enrolled,source_url,matched_intervention").eq("compound_id", id).limit(25),
      supabase.from("anecdotes").select("body,claimed_effect,sentiment,permalink,dose_mentioned").eq("compound_id", id),
      supabase.from("research_papers").select("title,journal,year,is_narrative,url").eq("compound_id", id),
      supabase.from("source_potency_priors").select("source_type,potency_mean,potency_sd,p_fail,p_contam,quantity_variance_p95,compound_id,basis").or(`compound_id.eq.${id},compound_id.is.null`),
      supabase.from("vendor_lab_results").select("vendor_name,purity_pct,label_mg,tested_mg,quantity_variance_pct,potency_factor,test_lab,failed").eq("compound_id", id),
      supabase.from("vendors").select("*").order("reliability_score", { ascending: false }),
    ]).then(([t, a, rp, sp, lr, v]) => {
      // prefer compound-specific prior over the NULL default, per source_type
      const bySource: Record<string, any> = {};
      for (const row of (sp.data ?? [])) {
        const cur = bySource[row.source_type];
        if (!cur || (row.compound_id && !cur.compound_id)) bySource[row.source_type] = row;
      }
      const order = ["compounding_pharmacy", "vendor_tested", "gray_market", "research_chem", "brand"];
      setDetail({
        trials: t.data ?? [],
        anecdotes: a.data ?? [],
        papers: rp.data ?? [],
        sourcePriors: order.map((k) => bySource[k]).filter(Boolean),
        labResults: lr.data ?? [],
        vendors: v.data ?? [],
      });
      setLoading(false);
    });
  }, [selected]);

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
                <Badge tone={c.approved ? "green" : "orange"}>{c.approved ? "FDA approved" : "Non-FDA"}</Badge>
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
                  <VendorGlobe vendors={detail.vendors} compoundName={selected.name} />

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
                      {detail.anecdotes.map((a, i) => {
                        const s = (a.sentiment ?? "").toLowerCase();
                        const tone: "green" | "yellow" | "orange" | "zinc" =
                          s === "positive" ? "green" : s === "mixed" ? "yellow" : s === "negative" ? "orange" : "zinc";
                        return (
                        <a key={i} href={a.permalink} target="_blank" rel="noreferrer" className="block text-sm hover:bg-zinc-950/60 rounded px-2 py-1.5 group">
                          <div className="flex items-center gap-2">
                            <Badge tone={tone}>{a.sentiment}</Badge>
                            <span className="text-zinc-300">{a.claimed_effect}</span>
                            {a.dose_mentioned && <span className="text-xs font-mono text-zinc-600">{a.dose_mentioned}</span>}
                          </div>
                          <p className="text-xs text-zinc-600 mt-0.5 truncate group-hover:text-zinc-500">{a.body}</p>
                        </a>
                        );
                      })}
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
                            <button type="button" onClick={() => toggle(k)} className="w-full flex items-center justify-between gap-3 text-sm px-3 py-2 hover:bg-zinc-900/60 rounded">
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                <Icon icon={open[k] ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"} className="text-zinc-600 text-xs shrink-0" />
                                <span className="text-zinc-200 truncate">{v.name}</span>
                                <Badge tone={SOURCE_TONE[v.source_type] ?? "zinc"}>{SOURCE_LABEL[v.source_type] ?? v.source_type}</Badge>
                              </span>
                              <span className="font-mono text-xs text-zinc-500 shrink-0 whitespace-nowrap">
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

                </>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
