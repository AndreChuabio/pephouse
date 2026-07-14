import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { VendorGlobe } from "../components/data-explorer/VendorGlobe";
import { ModuleGraph, ModuleStateInspector } from "../components/simulation2/ModuleGraph";
import { EvidenceMeter } from "../components/ui/EvidenceMeter";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { supabase } from "../lib/supabase";
import { tweetsForCompound } from "../data/tweets";
import type { SyntheaModuleRow } from "../lib/api";

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
  modules: SyntheaModuleRow[];
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

// The badge tones map onto the Instrument system: "green" carries the cool
// measured teal (a verified / tested / on-file fact), the others stay quiet
// graphite chips graded by luminance so a category reads as noted, not alarming.
function Badge({ tone, children }: { tone: "green" | "orange" | "yellow" | "zinc"; children: React.ReactNode }) {
  const map = {
    green: "bg-measured/10 text-measured border-measured/30",
    orange: "bg-surface-2 text-muted border-line-bright",
    yellow: "bg-surface-2 text-muted border-line",
    zinc: "bg-surface-2 text-faint border-line",
  } as const;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider whitespace-nowrap shrink-0 ${map[tone]}`}>
      {children}
    </span>
  );
}

function Section({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-surface/40 border border-line rounded-[var(--radius-card)] p-4">
      <h3 className="eyebrow !text-muted mb-3 flex items-center gap-2">
        <Icon icon={icon} className="text-faint" /> {title}
        <span className="readout text-faint">({count})</span>
      </h3>
      {count === 0 ? (
        <p className="void-hatch border border-line rounded-md px-3 py-2 text-xs text-faint italic">none in the database</p>
      ) : (
        children
      )}
    </div>
  );
}

// Tier numbering follows the Sim2 convention (frontend/src/data/simulation2.ts):
// higher number = more authoritative source. Never hue-coded — the label rides
// the neutral luminance ramp (brightest = strongest) and the meter does the rest.
const TIER_STYLES: Record<1 | 2 | 3 | 4, { text: string; hint: string }> = {
  4: { text: "text-ink", hint: "Trial-grade — highest confidence" },
  3: { text: "text-tier-3", hint: "Observational / published papers" },
  2: { text: "text-muted", hint: "Verified real-world / lab data" },
  1: { text: "text-faint", hint: "Anecdotal — forums / social" },
};

function TierHeader({ tier, label }: { tier: 1 | 2 | 3 | 4; label: string }) {
  const s = TIER_STYLES[tier];
  return (
    <div className="flex items-center gap-3 pt-3 pb-1">
      <EvidenceMeter tier={tier} className="shrink-0" />
      <span className={`readout text-[10px] font-bold uppercase tracking-widest ${s.text}`}>
        Tier {tier}
      </span>
      <span className="eyebrow !text-faint">&middot; {label}</span>
      <span className="text-[10px] text-faint italic ml-1">{s.hint}</span>
      <div className="flex-1 h-px bg-line ml-2" />
    </div>
  );
}

export default function DataExplorerPage() {
  useDocumentTitle("PepHouse | Cellar");
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
      .then(({ data }) => {
        const list = ((data ?? []) as Compound[])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
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
      supabase.from("synthea_modules").select("*").eq("compound_id", id).eq("active", true).order("id"),
    ]).then(([t, a, rp, sp, lr, v, mod]) => {
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
        modules: (mod.data ?? []) as SyntheaModuleRow[],
      });
      setLoading(false);
    });
  }, [selected]);

  return (
    <AppShell>
      <div className="h-16 flex items-center px-8 border-b border-line shrink-0 z-10">
        <h1 className="text-sm font-medium text-ink tracking-tight flex items-center gap-2">
          <Icon icon="solar:database-linear" className="text-signal" /> Cellar
        </h1>
      </div>

      <div className="flex-1 overflow-hidden flex z-10">
        {/* compound list */}
        <div className="w-64 border-r border-line overflow-y-auto shrink-0">
          {compounds.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              className={`w-full text-left px-4 py-3 border-b border-line transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-signal ${
                selected?.id === c.id ? "bg-surface-2" : "hover:bg-surface"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink font-display tracking-tight">{c.name}</span>
                <Badge tone={c.approved ? "green" : "orange"}>{c.approved ? "FDA approved" : "Non-FDA"}</Badge>
              </div>
              <p className="text-xs text-faint mt-0.5 truncate">{c.drug_class}</p>
            </button>
          ))}
        </div>

        {/* detail */}
        <div className="flex-1 overflow-y-auto p-8">
          {!selected ? (
            <p className="text-muted">Loading compounds&hellip;</p>
          ) : (
            <div className="max-w-4xl space-y-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-semibold text-ink font-display tracking-tight">{selected.name}</h2>
                  {detail && (
                    <EvidenceMeter
                      tier={
                        detail.trials.length
                          ? 4
                          : detail.papers.length
                            ? 3
                            : detail.labResults.length
                              ? 2
                              : detail.anecdotes.length
                                ? 1
                                : 0
                      }
                      className="shrink-0"
                    />
                  )}
                  <Badge tone={selected.approved ? "green" : "orange"}>{selected.approved ? "FDA approved" : "Non-FDA"}</Badge>
                </div>
                <p className="text-sm text-muted mt-1">{selected.drug_class}</p>
                <p className="text-sm text-muted mt-2">{selected.summary}</p>
              </div>

              {loading || !detail ? (
                <p className="text-muted text-sm">Loading data&hellip;</p>
              ) : (
                <>
                  <VendorGlobe vendors={detail.vendors} compoundName={selected.name} />

                  {(() => {
                    const xTweets = tweetsForCompound(selected.name);
                    type DoseReport = {
                      mcg: number;
                      raw: string;
                      source: "x" | "reddit";
                      permalink: string;
                      label: string;
                      sentiment: string;
                    };
                    const parseDose = (s: string | null | undefined): { mcg: number; raw: string } | null => {
                      if (!s) return null;
                      const m = s.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|μg|ug)\b/i);
                      if (!m) return null;
                      const v = parseFloat(m[1]);
                      const u = m[2].toLowerCase();
                      return { mcg: u === "mg" ? v * 1000 : v, raw: `${m[1]}${u}` };
                    };
                    const reports: DoseReport[] = [];
                    for (const t of xTweets) {
                      const p = parseDose(t.dose_mentioned);
                      if (p) reports.push({ ...p, source: "x", permalink: t.permalink, label: t.claimed_effect, sentiment: t.sentiment });
                    }
                    for (const a of detail.anecdotes) {
                      const p = parseDose(a.dose_mentioned);
                      if (p) reports.push({ ...p, source: "reddit", permalink: a.permalink, label: a.claimed_effect, sentiment: a.sentiment ?? "" });
                    }
                    reports.sort((a, b) => a.mcg - b.mcg);
                    const fmt = (mcg: number) => (mcg >= 1000 ? `${mcg / 1000}mg` : `${mcg}mcg`);
                    const min = reports[0]?.mcg;
                    const max = reports[reports.length - 1]?.mcg;
                    // Sentiment is anecdote, not a measured fact — so it rides neutral
                    // graphite luminances, with the one positive read leaning cool.
                    const sentColor = (s: string) => {
                      const k = (s ?? "").toLowerCase();
                      if (k === "positive") return "bg-measured";
                      if (k === "negative") return "bg-faint";
                      if (k === "mixed") return "bg-muted";
                      return "bg-ghost";
                    };
                    return (
                      <Section icon="solar:pills-linear" title="Reported Dosing" count={reports.length}>
                        {reports.length > 0 && (
                          <div className="mb-4 pt-2">
                            <div className="relative h-1 bg-line rounded-full mx-2">
                              {reports.map((r, i) => {
                                const pct = max === min ? 50 : ((r.mcg - min!) / (max! - min!)) * 100;
                                return (
                                  <div
                                    key={i}
                                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-base ${sentColor(r.sentiment)}`}
                                    style={{ left: `${pct}%` }}
                                    title={`${r.raw} · ${r.source === "x" ? "X" : "Reddit"} · ${r.sentiment}`}
                                  />
                                );
                              })}
                            </div>
                            <div className="flex justify-between mt-2 px-1 text-[10px] readout text-faint">
                              <span>{fmt(min!)}</span>
                              {min !== max && <span>{fmt(max!)}</span>}
                            </div>
                          </div>
                        )}
                        <div className="space-y-1">
                          {reports.map((r, i) => (
                            <a
                              key={i}
                              href={r.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between gap-3 text-sm hover:bg-surface-2 rounded px-2 py-1.5 group"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${sentColor(r.sentiment)}`}
                                  aria-hidden
                                />
                                <span className="readout text-ink shrink-0">{r.raw}</span>
                                <span className="text-[10px] uppercase tracking-wider text-faint shrink-0">
                                  {r.source === "x" ? "X" : "Reddit"}
                                </span>
                                <span className="text-faint truncate">&middot; {r.label}</span>
                              </span>
                              <Icon
                                icon="solar:arrow-right-up-linear"
                                className="text-faint opacity-0 group-hover:opacity-100 shrink-0"
                              />
                            </a>
                          ))}
                        </div>
                      </Section>
                    );
                  })()}

                  <Section icon="solar:diagram-up-linear" title="Synthea modules" count={detail.modules.length}>
                    <div className="space-y-2">
                      {detail.modules.map((m) => {
                        const k = `mod-${m.id}`;
                        const inspectorKey = `${k}-inspect`;
                        const expanded = open[k];
                        return (
                          <div key={m.id} className="bg-surface-2 rounded-lg border border-line">
                            <button
                              type="button"
                              onClick={() => toggle(k)}
                              className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-raised rounded-lg text-left"
                            >
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                <Icon
                                  icon={expanded ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"}
                                  className="text-faint text-xs shrink-0"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm text-ink truncate">{m.name}</span>
                                  <span className="block text-[11px] text-faint readout truncate">
                                    outcome=<span className="text-muted">{m.outcome_name}</span> · id={m.id}
                                    {m.source && <span> · {m.source}</span>}
                                  </span>
                                </span>
                              </span>
                              <span className="text-[10px] readout text-faint shrink-0">
                                {Object.keys(m.module?.states ?? {}).length} states
                              </span>
                            </button>
                            {expanded && (
                              <div className="px-3 pb-3 pt-1 space-y-2">
                                <div className="overflow-x-auto -mx-1 px-1">
                                  <ModuleGraph states={m.module?.states ?? {}} />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggle(inspectorKey)}
                                  className="text-[10px] uppercase tracking-widest text-faint hover:text-ink flex items-center gap-1"
                                >
                                  <Icon
                                    icon={open[inspectorKey] ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"}
                                    className="text-xs"
                                  />
                                  State inspector
                                </button>
                                {open[inspectorKey] && (
                                  <div className="pl-1">
                                    <ModuleStateInspector states={m.module?.states ?? {}} />
                                  </div>
                                )}
                                {m.module?.remarks && m.module.remarks.length > 0 && (
                                  <ul className="text-[11px] text-faint pl-4 list-disc space-y-0.5">
                                    {m.module.remarks.map((r, i) => (
                                      <li key={i}>{r}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  <TierHeader tier={4} label="Clinical RCTs" />

                  <Section icon="solar:document-text-linear" title="Clinical Trials" count={detail.trials.length}>
                    <div className="space-y-1.5">
                      {detail.trials.map((t, i) => (
                        <a key={i} href={t.source_url} target="_blank" rel="noreferrer" className="flex items-center justify-between text-sm hover:bg-surface-2 rounded px-2 py-1.5 group">
                          <span className="text-muted group-hover:text-signal"><span className="readout">{t.nct_id}</span> <span className="text-faint">&mdash; {t.indication}</span></span>
                          <span className="readout text-xs text-faint">{t.phase} &middot; n={t.n_enrolled ?? "?"} &middot; {t.status}</span>
                        </a>
                      ))}
                    </div>
                  </Section>

                  <TierHeader tier={3} label="Observational / papers" />

                  <Section icon="solar:book-linear" title="Research Papers" count={detail.papers.length}>
                    <div className="space-y-1.5">
                      {detail.papers.map((p, i) => (
                        <a key={i} href={p.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 text-sm hover:bg-surface-2 rounded px-2 py-1.5 group">
                          <span className="text-muted group-hover:text-signal">{p.title}</span>
                          <span className="shrink-0">
                            <Badge tone={p.is_narrative ? "zinc" : "green"}>{p.is_narrative ? "review" : "primary"}</Badge>
                            <span className="readout text-xs text-faint ml-1">{p.year}</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  </Section>

                  <TierHeader tier={2} label="Verified real-world / lab" />

                  <Section icon="solar:shield-warning-linear" title="Source Quality — delivered-dose variance" count={detail.sourcePriors.length}>
                    <p className="text-xs text-faint mb-3">delivered_dose = label &times; potency_factor. Where you source it shifts the curve.</p>
                    <div className="space-y-1.5">
                      {detail.sourcePriors.map((sp, i) => {
                        const k = `sp-${i}`;
                        return (
                          <div key={k} className="bg-surface-2 rounded-lg">
                            <button type="button" onClick={() => toggle(k)} className="w-full flex items-center justify-between text-sm px-3 py-2 hover:bg-raised rounded-lg">
                              <span className="flex items-center gap-2">
                                <Icon icon={open[k] ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"} className="text-faint text-xs" />
                                <Badge tone={SOURCE_TONE[sp.source_type] ?? "zinc"}>{SOURCE_LABEL[sp.source_type] ?? sp.source_type}</Badge>
                              </span>
                              <span className="readout text-xs text-muted">
                                potency {sp.potency_mean}&plusmn;{sp.potency_sd}
                                {sp.p_fail > 0 && <span className="text-danger/70"> &middot; {Math.round(sp.p_fail * 100)}% dud</span>}
                                {sp.p_contam > 0 && <span className="text-danger"> &middot; {Math.round(sp.p_contam * 100)}% contam</span>}
                              </span>
                            </button>
                            {open[k] && (
                              <div className="px-9 pb-3 pt-1 text-xs text-faint space-y-1">
                                <p>Delivered-dose model: <span className="text-muted readout">label &times; {sp.potency_mean}&plusmn;{sp.potency_sd}</span>, with a {Math.round((sp.p_fail || 0) * 100)}% chance of a near-inert "dud" lot{sp.p_contam > 0 ? ` and ${Math.round(sp.p_contam * 100)}% contamination risk` : ""}.</p>
                                {sp.quantity_variance_p95 != null && <p>Quantity divergence (95th pct): <span className="text-muted readout">&plusmn;{Math.round(sp.quantity_variance_p95 * 100)}%</span>{sp.n_samples ? ` across ${sp.n_samples} tested samples` : ""}.</p>}
                                <p className="flex items-center gap-2">
                                  <Badge tone={sp.basis === "verified" ? "green" : "zinc"}>{sp.basis === "verified" ? "verified" : "estimate"}</Badge>
                                  <span className="text-faint">{(sp.source_refs || []).find((r: string) => r.startsWith("http")) ? <a className="hover:text-signal" href={(sp.source_refs || []).find((r: string) => r.startsWith("http"))} target="_blank" rel="noreferrer">source &rarr;</a> : (sp.source_refs || [])[0]}</span>
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {detail.labResults.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-line">
                        <p className="eyebrow !text-measured mb-1.5">measured (third-party tested)</p>
                        {detail.labResults.map((lr, i) => (
                          <div key={i} className="flex items-center justify-between text-sm py-0.5">
                            <span className="text-muted">{lr.vendor_name} <span className="text-faint">&middot; {lr.test_lab}</span></span>
                            <span className="readout text-xs text-muted">
                              {lr.purity_pct}% pure, {lr.tested_mg}/{lr.label_mg}mg
                              <span className={lr.potency_factor < 0.95 ? "text-danger" : "text-measured"}> &rarr; {lr.potency_factor}&times;</span>
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
                          <div key={k} className="bg-surface-2 rounded-lg">
                            <button type="button" onClick={() => toggle(k)} className="w-full flex items-center justify-between gap-3 text-sm px-3 py-2 hover:bg-raised rounded-lg">
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                <Icon icon={open[k] ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"} className="text-faint text-xs shrink-0" />
                                <span className="text-ink font-display tracking-tight truncate">{v.name}</span>
                                <Badge tone={SOURCE_TONE[v.source_type] ?? "zinc"}>{SOURCE_LABEL[v.source_type] ?? v.source_type}</Badge>
                              </span>
                              <span className="readout text-xs text-faint shrink-0 whitespace-nowrap">
                                {v.finnrick_rating ? `rated ${v.finnrick_rating} · ` : ""}reliability {v.reliability_score}
                              </span>
                            </button>
                            {open[k] && (
                              <div className="px-9 pb-3 pt-1 text-xs text-muted space-y-1.5">
                                {v.manufacturer && <p>Manufacturer: <span className="text-ink">{v.manufacturer}</span></p>}
                                <p>Origin: <span className="text-ink">{v.country}</span> &middot; cost ~{v.cost_multiple_vs_gray}x gray-market</p>
                                <p className="flex flex-wrap gap-1.5">
                                  {v.third_party_tested && <Badge tone="green">3rd-party tested</Badge>}
                                  {v.gmp_certified && <Badge tone="green">GMP</Badge>}
                                  {v.fda_green_list && <Badge tone="green">FDA Green List</Badge>}
                                  {v.fda_dmf && <Badge tone="green">FDA DMF {v.fda_dmf}</Badge>}
                                </p>
                                {v.notes && <p className="text-faint">{v.notes}</p>}
                                {labs.map((lr, j) => (
                                  <p key={j} className="readout text-measured">measured {selected.name}: {lr.purity_pct}% pure, {lr.tested_mg}/{lr.label_mg}mg &rarr; {lr.potency_factor}&times;</p>
                                ))}
                                {v.source_url && <a className="text-signal hover:underline" href={v.source_url} target="_blank" rel="noreferrer">source &rarr;</a>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  <TierHeader tier={1} label="Anecdotal / forums" />

                  <Section icon="solar:chat-round-line-linear" title="Reddit Anecdotes" count={detail.anecdotes.length}>
                    <div className="space-y-2">
                      {detail.anecdotes.map((a, i) => {
                        const s = (a.sentiment ?? "").toLowerCase();
                        const tone: "green" | "yellow" | "orange" | "zinc" =
                          s === "positive" ? "green" : s === "mixed" ? "yellow" : s === "negative" ? "orange" : "zinc";
                        return (
                        <a key={i} href={a.permalink} target="_blank" rel="noreferrer" className="block text-sm hover:bg-surface-2 rounded px-2 py-1.5 group">
                          <div className="flex items-center gap-2">
                            <Badge tone={tone}>{a.sentiment}</Badge>
                            <span className="text-muted">{a.claimed_effect}</span>
                            {a.dose_mentioned && <span className="readout text-xs text-faint">{a.dose_mentioned}</span>}
                          </div>
                          <p className="text-xs text-faint mt-0.5 truncate group-hover:text-muted">{a.body}</p>
                        </a>
                        );
                      })}
                    </div>
                  </Section>

                  {(() => {
                    const xTweets = tweetsForCompound(selected.name);
                    return (
                  <Section icon="ri:twitter-x-line" title="X (Tweets)" count={xTweets.length}>
                    <div className="space-y-2">
                      {xTweets.map((t, i) => {
                        const s = (t.sentiment ?? "").toLowerCase();
                        const tone: "green" | "yellow" | "orange" | "zinc" =
                          s === "positive" ? "green" : s === "mixed" ? "yellow" : s === "negative" ? "orange" : "zinc";
                        return (
                        <a key={i} href={t.permalink} target="_blank" rel="noreferrer" className="block text-sm hover:bg-surface-2 rounded px-2 py-1.5 group">
                          <div className="flex items-center gap-2">
                            <Badge tone={tone}>{t.sentiment}</Badge>
                            <span className="text-muted">{t.claimed_effect}</span>
                            {t.dose_mentioned && <span className="readout text-xs text-faint">{t.dose_mentioned}</span>}
                          </div>
                          <p className="text-xs text-faint mt-0.5 truncate group-hover:text-muted">{t.body}</p>
                        </a>
                        );
                      })}
                    </div>
                  </Section>
                    );
                  })()}

                </>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
