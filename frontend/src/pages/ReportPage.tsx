import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { EvidenceMeter } from "../components/ui/EvidenceMeter";
import { Panel } from "../components/ui/Panel";
import { PanelHeader } from "../components/ui/PanelHeader";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { fetchCompounds } from "../lib/api";
import type { RegistryCompound } from "../lib/api";
import {
  PaymentRequiredError,
  confirmCheckout,
  fetchBillingStatus,
  fetchReport,
  previewReport,
  startCheckout,
} from "../lib/pephouse";
import type {
  BillingStatus,
  CompoundSection,
  InteractionPair,
  LadderRung,
  StackPreview,
  StackReport,
  TrialRow,
  Verdict,
} from "../lib/pephouse";

// The paid read on a member's stack.
//
// The one rule this page enforces: the STRENGTH of the evidence is the product.
// A rung with nothing on it stays on the ladder, a pair with no interaction data
// renders as UNKNOWN rather than as silence, and a recruiting trial is kept out
// of the evidence entirely. The free preview gives away the conclusion — nobody
// should have to pay to learn that what they are injecting has no evidence behind
// it. What is sold is the detail underneath the conclusion, never the warning.

// --------------------------------------------------------------------- helpers

type LoadState = "idle" | "loading" | "ready" | "error";
type CheckoutPhase = "none" | "confirming" | "confirmed" | "cancelled" | "error";

const STACK_STORAGE_KEY = "pephouse.report.stack";

/** The selected stack survives the round trip to Stripe, which returns to a bare
 *  /report?checkout=... with no room in the URL for the compound ids. */
function loadStoredStack(): number[] {
  try {
    const raw = window.localStorage.getItem(STACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  } catch {
    return [];
  }
}

function storeStack(ids: number[]): void {
  try {
    window.localStorage.setItem(STACK_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The stack is a
    // convenience here, not state the report depends on.
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 500 -> "$5", 1250 -> "$12.50".
 *
 *  Null when the backend did not give us a usable number. A missing price must
 *  never fall through to "$0": that is a false statement about what the button is
 *  a moment away from charging. */
function formatPrice(cents: number | null | undefined, currency: string | null): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  const amount = cents / 100;
  const whole = cents % 100 === 0;
  const code = (currency ?? "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    // Intl throws on a currency code it does not know.
    return `$${whole ? amount.toFixed(0) : amount.toFixed(2)}`;
  }
}

/** The verdict is the one sentence a member is here for. If the backend sent
 *  nothing, say that the record is empty rather than rendering an empty line the
 *  reader will fill in with something kinder than the truth. */
function verdictText(text: string | null | undefined): string {
  const trimmed = text?.trim();
  if (trimmed) return trimmed;
  return "No verdict text on file for this compound. That is a gap in the record, not reassurance.";
}

// The backend sends `locked` as machine slugs — "evidence_ladder", "trials",
// "interactions", "counts". They are keys, not copy, and must never reach a
// reader as-is.
const LOCKED_LABELS: Record<string, string> = {
  evidence_ladder:
    "Every rung of the evidence ladder with the count behind it, including the rungs that are empty.",
  trials:
    "The completed trials with their registry ids, and the registered trials that have not reported yet.",
  interactions: "Every pair across your stack, including the pairs nobody has studied.",
  counts: "Papers, case studies, anecdotes, and independent assays, counted per compound.",
};

/** "evidence_ladder" -> "Evidence ladder". Last resort for a slug we do not know. */
function lockedLabel(slug: string): string {
  const known = LOCKED_LABELS[slug];
  if (known) return known;
  const words = slug.replace(/[_-]+/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ------------------------------------------------------------------- tier meta

type Tier = 1 | 2 | 3 | 4;

interface TierMeta {
  name: string;
  hint: string;
  text: string;
  dot: string;
  border: string;
}

// Numbering matches the rest of the app (Cellar, Arena): higher = stronger.
// Tier 4 is COMPLETED trials only. A registered trial never reaches this ladder.
// Tiers are ranked by a neutral luminance ramp — strength, never a good/bad hue.
// Tier 4 (completed trials) is the brightest ink, tier 1 (anecdote) the dimmest.
const TIER_META: Record<Tier, TierMeta> = {
  4: {
    name: "Completed clinical trials",
    hint: "Finished, with a result. The only thing that settles a question.",
    text: "text-tier-4",
    dot: "bg-tier-4",
    border: "border-line-bright",
  },
  3: {
    name: "Observational / papers",
    hint: "Published, but not a controlled trial.",
    text: "text-tier-3",
    dot: "bg-tier-3",
    border: "border-line",
  },
  2: {
    // This rung counts independent third-party assays and sourcing records. It is
    // never fed by a vendor's own certificate: a vendor saying it tested itself is
    // a claim, and a claim is not a measurement. Even at full count, this rung
    // speaks to what is in the vial and says nothing about whether it works.
    name: "Verified real-world / lab data",
    hint: "Independent assays and sourcing records. What is in the vial, not whether it works.",
    text: "text-tier-2",
    dot: "bg-tier-2",
    border: "border-line",
  },
  1: {
    name: "Anecdotal / forums",
    hint: "Someone said so. That is all.",
    text: "text-tier-1",
    dot: "bg-tier-1",
    border: "border-line",
  },
};

const TIER_ORDER: Tier[] = [4, 3, 2, 1];

interface VerdictMeta {
  label: string;
  text: string;
  bg: string;
  border: string;
}

// The verdict tag reads on the same neutral luminance ramp as the tiers: brighter
// = stronger evidence, never a hue that says good or bad. no_evidence is the void,
// hatched so an absence reads as a finding rather than a blank.
const VERDICT_META: Record<Verdict, VerdictMeta> = {
  trial_backed: {
    label: "Trial backed",
    text: "text-ink",
    bg: "bg-surface-2",
    border: "border-line-bright",
  },
  observational_only: {
    label: "Observational only",
    text: "text-tier-3",
    bg: "bg-surface-2",
    border: "border-line",
  },
  source_data_only: {
    label: "Source data only",
    text: "text-tier-2",
    bg: "bg-surface",
    border: "border-line",
  },
  anecdote_only: {
    label: "Anecdote only",
    text: "text-tier-1",
    bg: "bg-surface",
    border: "border-line",
  },
  no_evidence: {
    label: "No evidence on file",
    text: "text-faint",
    bg: "void-hatch bg-surface",
    border: "border-line",
  },
};

function verdictMeta(verdict: Verdict | null): VerdictMeta {
  if (verdict && verdict in VERDICT_META) return VERDICT_META[verdict];
  return VERDICT_META.no_evidence;
}

interface SeverityMeta {
  label: string;
  text: string;
  bg: string;
  border: string;
}

// A documented harm is the one place the loud danger red is earned. An unknown
// pair is not danger and not safe — it is an honest gap, so it carries the warm
// signal, never green.
const SEVERITY_META: Record<InteractionPair["severity"], SeverityMeta> = {
  major: {
    label: "Major",
    text: "text-danger",
    bg: "bg-danger/10",
    border: "border-danger/40",
  },
  moderate: {
    label: "Moderate",
    text: "text-danger",
    bg: "bg-danger/[0.06]",
    border: "border-danger/25",
  },
  minor: {
    label: "Minor",
    text: "text-muted",
    bg: "bg-surface-2",
    border: "border-line",
  },
  unknown: {
    label: "Unknown",
    text: "text-signal",
    bg: "bg-signal/10",
    border: "border-signal/40",
  },
};

// ------------------------------------------------------------ small components

interface VerdictBadgeProps {
  verdict: Verdict | null;
}

function VerdictBadge({ verdict }: VerdictBadgeProps) {
  const meta = verdictMeta(verdict);
  return (
    <span
      className={`readout px-2 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider whitespace-nowrap shrink-0 ${meta.bg} ${meta.text} ${meta.border}`}
    >
      {meta.label}
    </span>
  );
}

interface LadderProps {
  ladder: LadderRung[];
}

/** Rungs 4 down to 1, always all four. An empty rung is the finding: it stays on
 *  the page, labelled, so the reader sees the hole rather than a tidy list of the
 *  things that happen to exist. */
function EvidenceLadder({ ladder }: LadderProps) {
  const rungFor = (tier: Tier): LadderRung => {
    const found = ladder.find((rung) => rung.tier === tier);
    if (found) return found;
    return { tier, label: TIER_META[tier].name, count: 0, available: false };
  };

  return (
    <div className="space-y-1.5">
      {TIER_ORDER.map((tier) => {
        const rung = rungFor(tier);
        const meta = TIER_META[tier];
        // A null count is a count we do not have. It reads as empty, which is the
        // only safe direction to round in.
        const count = Number.isFinite(rung.count) ? rung.count : 0;
        const empty = count <= 0;
        return (
          <div
            key={tier}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
              empty
                ? "border-dashed border-line void-hatch"
                : `bg-surface ${meta.border}`
            }`}
          >
            <span
              className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                empty ? "bg-line-bright" : meta.dot
              }`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`readout text-[10px] font-bold uppercase tracking-widest ${
                    empty ? "text-faint" : meta.text
                  }`}
                >
                  Tier {tier}
                </span>
                <span
                  className={`text-sm ${empty ? "text-muted" : "text-ink"}`}
                >
                  {rung.label || meta.name}
                </span>
              </div>
              <p className="text-[11px] text-faint mt-0.5">{meta.hint}</p>
            </div>
            <span className="shrink-0 text-right">
              {empty ? (
                <span className="readout text-[11px] text-faint uppercase tracking-wider">
                  No data on file
                </span>
              ) : (
                <span className={`readout text-sm ${meta.text}`}>{count}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface TrialLineProps {
  trial: TrialRow;
  evidence: boolean;
}

function TrialLine({ trial, evidence }: TrialLineProps) {
  const href = trial.nct_id
    ? `https://clinicaltrials.gov/study/${trial.nct_id}`
    : trial.source_url;

  // Every absent field is named. Status especially: it is the field that decides
  // whether a trial is evidence at all, so dropping it when it is null would hide
  // the one thing the reader needs to judge the row.
  const parts: string[] = [
    trial.phase?.trim() || "Phase not on file",
    trial.n_participants != null && Number.isFinite(trial.n_participants)
      ? `n = ${trial.n_participants}`
      : "n not on file",
    trial.status?.trim() || "Status not on file",
  ];

  const body = (
    <>
      <span className="min-w-0 flex items-center gap-2">
        <Icon
          icon={evidence ? "solar:document-text-linear" : "solar:hourglass-linear"}
          className={`shrink-0 ${evidence ? "text-ink" : "text-faint"}`}
        />
        <span
          className={`readout text-sm truncate ${
            href ? "text-ink group-hover:text-signal transition-colors" : "text-muted"
          }`}
        >
          {trial.nct_id ?? "No registry id on file"}
        </span>
        {/* The row carries its own status. A registered trial gets copied, screenshotted
            and quoted out from under the heading that called it "not evidence". */}
        {!evidence && (
          <span className="readout shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border border-line bg-surface-2 text-muted">
            Not evidence
          </span>
        )}
      </span>
      <span className="readout text-[11px] text-faint shrink-0 text-right">
        {parts.join(" · ")}
      </span>
    </>
  );

  const className =
    "flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 group";

  if (!href) {
    return <div className={className}>{body}</div>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`${className} hover:border-line-bright transition-colors`}
    >
      {body}
    </a>
  );
}

interface CountTileProps {
  icon: string;
  label: string;
  count: number;
}

/** Zero is a result, so a zero tile renders with the same weight as any other and
 *  says out loud that there is nothing there. */
function CountTile({ icon, label, count }: CountTileProps) {
  const empty = count <= 0;
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        empty ? "border-dashed border-line void-hatch" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-center gap-1.5 eyebrow">
        <Icon icon={icon} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 readout text-lg ${empty ? "text-faint" : "text-ink"}`}>
        {count}
      </div>
      {empty && <div className="readout text-[10px] text-faint">None on file</div>}
    </div>
  );
}

interface MissingCompoundsProps {
  ids: number[];
  nameFor: (id: number) => string;
}

/** A compound the registry has never heard of is a finding in its own right.
 *
 *  The paid report returns these as `unknown_compound_ids`. The free preview does
 *  not return them at all — the backend drops unknown compounds on the floor — so
 *  the caller reconstructs the list and hands it here. Either way the compound
 *  gets named. Quietly rendering a shorter list than the one the member selected
 *  is the precise failure this product exists to prevent: the compound with the
 *  least behind it is the one that disappears. */
function MissingCompounds({ ids, nameFor }: MissingCompoundsProps) {
  if (ids.length === 0) return null;
  return (
    <Panel className="p-5 sm:p-6 border-signal/40">
      <PanelHeader icon="solar:question-circle-linear" title="Not in the registry" />
      <p className="text-sm text-muted leading-relaxed">
        PepHouse has nothing on file for {ids.map(nameFor).join(", ")}. That is a finding, not an
        omission: no trials, no papers, no lab data, no interaction rows. It is not covered by the
        read above and it is not covered by any pair below. Treat it as unstudied.
      </p>
    </Panel>
  );
}

interface InteractionRowProps {
  pair: InteractionPair;
}

/** A pair with no data must not read like a clean bill of health. It gets the
 *  warm signal treatment, a dashed hatched border, and the word UNKNOWN. */
function InteractionRow({ pair }: InteractionRowProps) {
  const nameA = pair.compound_a_name ?? `Compound ${pair.compound_a_id}`;
  const nameB = pair.compound_b_name ?? `Compound ${pair.compound_b_id}`;

  if (!pair.has_data) {
    const meta = SEVERITY_META.unknown;
    return (
      <div className="rounded-lg border border-dashed border-signal/40 void-hatch px-3 py-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-ink min-w-0">
            {nameA} <span className="text-faint">+</span> {nameB}
          </span>
          <span
            className={`readout px-2 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider shrink-0 ${meta.bg} ${meta.text} ${meta.border}`}
          >
            Unknown
          </span>
        </div>
        <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
          No interaction data on file for this pair. Nobody has looked, or nobody has
          published. That is not the same as safe, and it must not be read that way.
        </p>
      </div>
    );
  }

  const meta = SEVERITY_META[pair.severity] ?? SEVERITY_META.unknown;
  return (
    <div className={`rounded-lg border bg-surface px-3 py-2.5 ${meta.border}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-ink min-w-0">
          {nameA} <span className="text-faint">+</span> {nameB}
        </span>
        <span
          className={`readout px-2 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider shrink-0 ${meta.bg} ${meta.text} ${meta.border}`}
        >
          {meta.label}
        </span>
      </div>
      {pair.mechanism && (
        <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
          <span className="text-faint uppercase tracking-wider">Mechanism</span>{" "}
          {pair.mechanism}
        </p>
      )}
      {pair.management && (
        <p className="text-[11px] text-muted mt-1 leading-relaxed">
          <span className="text-faint uppercase tracking-wider">Management</span>{" "}
          {pair.management}
        </p>
      )}
      {!pair.mechanism && !pair.management && (
        <p className="text-[11px] text-faint mt-1.5 italic">
          Flagged, but no mechanism or management guidance is on file.
        </p>
      )}
    </div>
  );
}

interface CompoundReportProps {
  section: CompoundSection;
}

function CompoundReport({ section }: CompoundReportProps) {
  const inProgress = section.trials_in_progress ?? [];
  const completed = section.completed_trials ?? [];

  return (
    <Panel className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-ink tracking-tight">
            {section.name}
          </h3>
          <p className="text-xs text-faint mt-0.5">
            {section.drug_class ?? "Drug class not on file"}
            <span className="text-ghost"> · </span>
            {section.fda_status ?? (section.approved ? "FDA approved" : "Not FDA approved")}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <EvidenceMeter tier={section.top_tier} />
          <VerdictBadge verdict={section.verdict} />
        </div>
      </div>

      <p className="text-sm text-muted leading-relaxed mt-3">
        {verdictText(section.verdict_text)}
      </p>

      {section.summary && (
        <p className="text-xs text-faint leading-relaxed mt-2">{section.summary}</p>
      )}

      <div className="mt-5">
        <h4 className="eyebrow mb-2.5 flex items-center gap-1.5">
          <Icon icon="solar:ranking-linear" /> Evidence ladder
        </h4>
        <EvidenceLadder ladder={section.evidence_ladder ?? []} />
      </div>

      <div className="mt-5">
        <h4 className="eyebrow mb-2.5 flex items-center gap-1.5">
          <Icon icon="solar:document-text-linear" /> Completed trials
          <span className="text-ghost normal-case tracking-normal font-normal">
            — the evidence
          </span>
        </h4>
        {completed.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line void-hatch px-3 py-3">
            <p className="text-sm text-muted">
              No completed clinical trial on file for {section.name}.
            </p>
            <p className="text-[11px] text-faint mt-1">
              Nothing has been finished and reported that would tell you whether this works,
              at what dose, or at what cost.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {completed.map((trial, i) => (
              <TrialLine key={`completed-${trial.nct_id ?? "no-id"}-${i}`} trial={trial} evidence />
            ))}
          </div>
        )}
      </div>

      {inProgress.length > 0 && (
        <div className="mt-5">
          <h4 className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Icon icon="solar:hourglass-linear" /> Registered, still running
            <span className="text-ghost normal-case tracking-normal font-normal">
              — not evidence
            </span>
          </h4>
          <div className="rounded-lg border border-line bg-surface px-3 py-3">
            <p className="text-[11px] text-muted leading-relaxed mb-2.5">
              {section.trials_note ??
                `${inProgress.length} registered trial(s) have not produced a result yet. A registered trial is not evidence.`}{" "}
              <span className="text-faint">
                Someone is finally studying this, which is worth knowing. It proves nothing
                yet, and it does not raise the tier above.
              </span>
            </p>
            <div className="space-y-1.5">
              {inProgress.map((trial, i) => (
                <TrialLine
                  key={`in-progress-${trial.nct_id ?? "no-id"}-${i}`}
                  trial={trial}
                  evidence={false}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CountTile icon="solar:book-linear" label="Papers" count={section.research_papers ?? 0} />
        <CountTile
          icon="solar:clipboard-list-linear"
          label="Case studies"
          count={section.case_studies ?? 0}
        />
        <CountTile
          icon="solar:chat-round-line-linear"
          label="Anecdotes"
          count={section.anecdotes ?? 0}
        />
        {/* vendor_lab_results is the third-party assay table. A vendor's own COA is a
            claim and lives elsewhere; it is never counted here, and the label says so
            rather than letting "Lab results" absorb both. */}
        <CountTile
          icon="solar:flask-linear"
          label="Independent assays"
          count={section.lab_results ?? 0}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- the page

export default function ReportPage() {
  useDocumentTitle("PepHouse | Report");
  const { isAnonymous, signInWithGoogle } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- stack builder ----
  const [compounds, setCompounds] = useState<RegistryCompound[]>([]);
  const [compoundState, setCompoundState] = useState<LoadState>("loading");
  const [compoundError, setCompoundError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>(() => loadStoredStack());
  const [query, setQuery] = useState("");

  // ---- preview / billing / report ----
  const [preview, setPreview] = useState<StackPreview | null>(null);
  const [previewState, setPreviewState] = useState<LoadState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingState, setBillingState] = useState<LoadState>("loading");
  const [billingError, setBillingError] = useState<string | null>(null);

  const [report, setReport] = useState<StackReport | null>(null);
  const [reportState, setReportState] = useState<LoadState>("idle");
  const [reportError, setReportError] = useState<string | null>(null);

  const [checkoutPhase, setCheckoutPhase] = useState<CheckoutPhase>("none");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Stripe returns to a bare /report?checkout=..., so the boot sequence has to run
  // exactly once: confirm the session, then re-read billing. A ref rather than a
  // dep list, so a StrictMode double-mount cannot confirm the same session twice.
  const bootRef = useRef(false);

  useEffect(() => {
    fetchCompounds()
      .then((rows) => {
        const list = [...rows].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
        setCompounds(list);
        setCompoundState("ready");
      })
      .catch((err: unknown) => {
        setCompoundError(errorText(err, "Could not load the compound registry."));
        setCompoundState("error");
      });
  }, []);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;

    const boot = async (): Promise<void> => {
      const token = searchParams.get("checkout");

      if (token && token !== "cancelled") {
        setCheckoutPhase("confirming");
        try {
          // This is what makes the purchase land when no Stripe webhook is wired up.
          await confirmCheckout(token);
          setCheckoutPhase("confirmed");
        } catch (err: unknown) {
          setCheckoutError(
            errorText(err, "We could not confirm that payment. Nothing has been charged twice."),
          );
          setCheckoutPhase("error");
        }
      } else if (token === "cancelled") {
        setCheckoutPhase("cancelled");
      }

      if (token) {
        const next = new URLSearchParams(searchParams);
        next.delete("checkout");
        setSearchParams(next, { replace: true });
      }

      // Billing is re-read from the server either way: the confirm call is a hint,
      // the status endpoint is the truth.
      try {
        const status = await fetchBillingStatus();
        setBilling(status);
        setBillingState("ready");
      } catch (err: unknown) {
        setBillingError(errorText(err, "Could not read the billing status."));
        setBillingState("error");
      }
    };

    void boot();
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    storeStack(selected);
  }, [selected]);

  // Free preview. Runs on every selection change, entitlement or not.
  useEffect(() => {
    if (selected.length === 0) {
      setPreview(null);
      setPreviewState("idle");
      setPreviewError(null);
      return;
    }
    let alive = true;
    setPreviewState("loading");
    setPreviewError(null);
    previewReport(selected)
      .then((data) => {
        if (!alive) return;
        setPreview(data);
        setPreviewState("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setPreviewError(errorText(err, "Could not build the preview."));
        setPreviewState("error");
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Full report. Only attempted with an entitlement; a 402 drops back to the paywall.
  const hasAccess = billing?.has_access === true;

  useEffect(() => {
    if (!hasAccess || selected.length === 0) {
      setReport(null);
      setReportState("idle");
      setReportError(null);
      return;
    }
    let alive = true;
    setReportState("loading");
    setReportError(null);
    fetchReport(selected)
      .then((data) => {
        if (!alive) return;
        setReport(data);
        setReportState("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof PaymentRequiredError) {
          // The entitlement is not there after all. Back to the paywall, quietly.
          setReport(null);
          setReportState("idle");
          setBilling((prev) => (prev ? { ...prev, has_access: false } : prev));
          return;
        }
        setReportError(errorText(err, "Could not build the report."));
        setReportState("error");
      });
    return () => {
      alive = false;
    };
  }, [selected, hasAccess]);

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const compound of compounds) map.set(compound.id, compound.name);
    return map;
  }, [compounds]);

  const compoundLabel = (id: number): string => nameById.get(id) ?? `#${id}`;

  // /report/preview does not return unknown_compound_ids — report.build() drops the
  // compounds it cannot find and the preview endpoint never forwards the list. So a
  // free reader who picks something the registry has never heard of would just get a
  // shorter list back, with no gap where it used to be. Rebuild the gap here.
  const previewMissingIds = useMemo(() => {
    if (!preview) return [];
    const known = new Set((preview.compounds ?? []).map((compound) => compound.compound_id));
    return selected.filter((id) => !known.has(id));
  }, [preview, selected]);

  const priceLabel = billing ? formatPrice(billing.price_cents, billing.currency) : null;

  const visibleCompounds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return compounds;
    return compounds.filter((compound) => {
      if (compound.name.toLowerCase().includes(needle)) return true;
      const aliases = compound.aliases ?? [];
      return aliases.some((alias) => alias.toLowerCase().includes(needle));
    });
  }, [compounds, query]);

  const toggleCompound = (id: number): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBuy = async (): Promise<void> => {
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const url = await startCheckout();
      // An empty URL would make assign() silently reload the page, which looks
      // exactly like a checkout that quietly failed.
      if (!url) throw new Error("Checkout did not return a URL.");
      window.location.assign(url);
    } catch (err: unknown) {
      setCheckoutError(errorText(err, "Could not open checkout. Try again."));
      setCheckoutBusy(false);
    }
  };

  const handleSignIn = async (): Promise<void> => {
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      setAuthBusy(false);
    }
  };

  const interactions = report?.interactions ?? null;
  const unknownIds = report?.unknown_compound_ids ?? [];
  // Pairs are built across the compounds the registry KNOWS, not the ones the member
  // ticked. Selecting two where one is unknown yields zero pairs, and "add a second
  // compound" would be a nonsense reply to a member looking at two.
  const knownCount = report?.compounds?.length ?? 0;

  return (
    <AppShell>
      <div className="h-16 flex items-center px-6 sm:px-8 border-b border-line shrink-0 z-10">
        <h1 className="font-display text-sm font-medium text-ink tracking-tight flex items-center gap-2">
          <Icon icon="solar:clipboard-check-linear" className="text-signal" /> Stack report
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 space-y-6">
          {/* ---------------------------------------------------- stack builder */}
          <Panel className="p-5 sm:p-6">
            <PanelHeader
              icon="solar:test-tube-linear"
              title="Your stack"
              action={
                selected.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="text-[11px] text-faint hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 rounded"
                  >
                    Clear
                  </button>
                ) : undefined
              }
            />
            <p className="text-xs text-faint mb-4 leading-relaxed">
              Pick everything you are running. The report reads the evidence behind each one
              and every pair across the stack.
            </p>

            {compoundState === "loading" && (
              <div className="text-sm text-faint flex items-center gap-2 py-4">
                <Icon icon="svg-spinners:180-ring" className="text-signal" /> Loading compounds
              </div>
            )}

            {compoundState === "error" && (
              <p className="text-xs text-danger" role="alert">
                {compoundError}
              </p>
            )}

            {compoundState === "ready" && (
              <>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search compounds"
                  className="w-full bg-base border border-line rounded-lg py-2 px-3 text-sm text-ink placeholder:text-faint outline-none focus:border-signal transition-colors mb-3"
                />

                {visibleCompounds.length === 0 ? (
                  <p className="text-xs text-faint italic py-2">
                    Nothing in the registry matches that.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                    {visibleCompounds.map((compound) => {
                      const on = selected.includes(compound.id);
                      return (
                        <button
                          key={compound.id}
                          type="button"
                          onClick={() => toggleCompound(compound.id)}
                          aria-pressed={on}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 ${
                            on
                              ? "border-signal/50 bg-signal/10"
                              : "border-line bg-surface hover:border-line-bright"
                          }`}
                        >
                          <Icon
                            icon={on ? "solar:check-circle-bold" : "solar:add-circle-linear"}
                            className={`shrink-0 ${on ? "text-signal" : "text-faint"}`}
                          />
                          <span
                            className={`text-sm truncate ${on ? "text-ink" : "text-muted"}`}
                          >
                            {compound.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-[11px] text-faint mt-3">
                  {selected.length === 0
                    ? "Nothing selected yet."
                    : `${selected.length} selected: ${selected
                        .map((id) => nameById.get(id) ?? `#${id}`)
                        .join(", ")}`}
                </p>
              </>
            )}
          </Panel>

          {/* ------------------------------------------------------ free preview */}
          {selected.length > 0 && (
            <Panel className="p-5 sm:p-6">
              <PanelHeader
                icon="solar:eye-linear"
                title="The read"
                action={
                  <span className="readout text-[10px] uppercase tracking-widest text-measured border border-measured/30 bg-measured/10 rounded px-2 py-0.5">
                    Free
                  </span>
                }
              />

              {previewState === "loading" && (
                <div className="text-sm text-faint flex items-center gap-2 py-4">
                  <Icon icon="svg-spinners:180-ring" className="text-signal" /> Reading the
                  evidence
                </div>
              )}

              {previewState === "error" && (
                <p className="text-xs text-danger" role="alert">
                  {previewError}
                </p>
              )}

              {previewState === "ready" && preview && (
                <>
                  <p className="font-display text-base sm:text-lg text-ink leading-relaxed font-medium tracking-tight">
                    {preview.summary?.headline?.trim() ||
                      "No headline came back for this stack. Read each compound below on its own terms."}
                  </p>
                  <p className="text-[11px] text-faint mt-2 leading-relaxed">
                    This is the conclusion, and it is free. You should never have to pay to find
                    out that what you are injecting has nothing behind it. What the full report
                    sells is the evidence underneath: the trials, the counts, the gaps, and the
                    interactions across the stack.
                  </p>

                  <div className="mt-4 space-y-2">
                    {(preview.compounds ?? []).map((compound) => (
                      <div
                        key={compound.compound_id}
                        className="rounded-lg border border-line bg-surface px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="flex items-center gap-2.5 min-w-0">
                            <EvidenceMeter tier={compound.top_tier} className="shrink-0" />
                            <span className="font-display text-sm font-medium text-ink truncate">
                              {compound.name}
                            </span>
                          </span>
                          <VerdictBadge verdict={compound.verdict} />
                        </div>
                        <p className="text-xs text-muted mt-1.5 leading-relaxed">
                          {verdictText(compound.verdict_text)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {(preview.locked?.length ?? 0) > 0 && !hasAccess && (
                    <div className="mt-4 pt-4 border-t border-line">
                      <p className="eyebrow mb-2">
                        In the full report
                      </p>
                      <ul className="space-y-1">
                        {(preview.locked ?? []).map((item) => {
                          const label = lockedLabel(item);
                          if (!label) return null;
                          return (
                            <li
                              key={item}
                              className="text-xs text-muted flex items-start gap-2 leading-relaxed"
                            >
                              <Icon
                                icon="solar:lock-keyhole-minimalistic-linear"
                                className="text-faint shrink-0 mt-0.5"
                              />
                              {label}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </Panel>
          )}

          {/* A compound the registry does not know is a finding, and the free reader gets
              it too. Paying is not a condition of being told that we have nothing. */}
          {!hasAccess && previewState === "ready" && (
            <MissingCompounds ids={previewMissingIds} nameFor={compoundLabel} />
          )}

          {/* --------------------------------------------------------- checkout */}
          {selected.length > 0 && (
            <>
              {checkoutPhase === "confirming" && (
                <Panel className="p-5 sm:p-6">
                  <div className="text-sm text-muted flex items-center gap-2">
                    <Icon icon="svg-spinners:180-ring" className="text-signal" /> Confirming your
                    payment
                  </div>
                </Panel>
              )}

              {checkoutPhase === "error" && checkoutError && (
                <Panel className="p-5 sm:p-6 border-danger/40">
                  <p className="text-sm text-danger" role="alert">
                    {checkoutError}
                  </p>
                  <p className="text-xs text-faint mt-1.5">
                    If the payment went through, reload this page. If it did not, nothing was
                    charged.
                  </p>
                </Panel>
              )}

              {billingState === "loading" && (
                <Panel className="p-5 sm:p-6">
                  <div className="text-sm text-faint flex items-center gap-2">
                    <Icon icon="svg-spinners:180-ring" className="text-signal" /> Checking access
                  </div>
                </Panel>
              )}

              {billingState === "error" && (
                <Panel className="p-5 sm:p-6 border-danger/40">
                  <p className="text-sm text-danger" role="alert">
                    {billingError}
                  </p>
                </Panel>
              )}

              {billingState === "ready" && billing && !billing.configured && (
                <Panel className="p-5 sm:p-6">
                  <PanelHeader icon="solar:card-linear" title="Full report" />
                  <p className="text-sm text-muted leading-relaxed">
                    Payments are not set up on this deployment, so the full report cannot be
                    bought right now.
                  </p>
                  <p className="text-xs text-faint mt-2 leading-relaxed">
                    The read above is the whole conclusion and it stands on its own. Nothing about
                    the evidence changes because the checkout is offline.
                  </p>
                </Panel>
              )}

              {billingState === "ready" && billing && billing.configured && !billing.has_access && (
                <Panel className="p-5 sm:p-6">
                  <PanelHeader icon="solar:card-linear" title="Full report" />
                  <p className="text-sm text-muted leading-relaxed">
                    The evidence behind the read: every rung of the ladder with its count, the
                    completed trials with their registry ids, the trials still running, and every
                    interaction pair across your stack including the ones nobody has studied.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleBuy()}
                    disabled={checkoutBusy}
                    className="mt-4 w-full rounded-lg bg-signal hover:bg-signal-bright px-4 py-2.5 text-sm font-semibold text-on-signal flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
                  >
                    <Icon
                      icon={checkoutBusy ? "svg-spinners:180-ring" : "solar:lock-keyhole-linear"}
                    />
                    {checkoutBusy
                      ? "Opening checkout"
                      : priceLabel
                        ? `Unlock the full report — ${priceLabel}`
                        : "Unlock the full report"}
                  </button>
                  {!priceLabel && (
                    <p className="text-[11px] text-muted mt-2 text-center">
                      The price did not load. Checkout will show it before anything is charged.
                    </p>
                  )}
                  <p className="text-[11px] text-faint mt-2 text-center">
                    One payment. No subscription.
                  </p>

                  {checkoutError && checkoutPhase !== "error" && (
                    <p className="text-[11px] text-danger mt-2 text-center" role="alert">
                      {checkoutError}
                    </p>
                  )}

                  {checkoutPhase === "cancelled" && (
                    <p className="text-[11px] text-faint mt-2 text-center">
                      Checkout was cancelled. Nothing was charged.
                    </p>
                  )}

                  {isAnonymous && (
                    <p className="text-[11px] text-faint mt-3 leading-relaxed text-center">
                      You are on a guest session, so the purchase would be tied to this browser.{" "}
                      <button
                        type="button"
                        onClick={() => void handleSignIn()}
                        disabled={authBusy}
                        className="text-signal hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 rounded"
                      >
                        Sign in with Google
                      </button>{" "}
                      first to keep it.
                    </p>
                  )}
                </Panel>
              )}
            </>
          )}

          {/* ----------------------------------------------------- full report */}
          {hasAccess && selected.length > 0 && (
            <>
              {reportState === "loading" && (
                <Panel className="p-5 sm:p-6">
                  <div className="text-sm text-faint flex items-center gap-2">
                    <Icon icon="svg-spinners:180-ring" className="text-signal" /> Building the
                    report
                  </div>
                </Panel>
              )}

              {reportState === "error" && (
                <Panel className="p-5 sm:p-6 border-danger/40">
                  <p className="text-sm text-danger" role="alert">
                    {reportError}
                  </p>
                </Panel>
              )}

              {reportState === "ready" && report && (
                <>
                  {checkoutPhase === "confirmed" && (
                    <p className="text-xs text-measured flex items-center gap-1.5">
                      <Icon icon="solar:check-circle-linear" /> Payment confirmed. The full report
                      is below.
                    </p>
                  )}

                  <MissingCompounds ids={unknownIds} nameFor={compoundLabel} />

                  {(report.compounds ?? []).map((section) => (
                    <CompoundReport key={section.compound_id} section={section} />
                  ))}

                  {/* interactions */}
                  <Panel className="p-5 sm:p-6">
                    <PanelHeader
                      icon="solar:link-broken-linear"
                      title="Interactions across the stack"
                      action={
                        interactions ? (
                          <span className="readout text-[11px] text-faint">
                            {interactions.pairs_with_data} with data ·{" "}
                            <span
                              className={
                                interactions.pairs_without_data > 0
                                  ? "text-signal"
                                  : "text-faint"
                              }
                            >
                              {interactions.pairs_without_data} unknown
                            </span>
                          </span>
                        ) : undefined
                      }
                    />

                    {interactions && interactions.pairs_without_data > 0 && (
                      <div className="rounded-lg border border-signal/40 bg-signal/[0.06] px-3 py-3 mb-3">
                        <p className="text-sm text-muted leading-relaxed flex items-start gap-2">
                          <Icon
                            icon="solar:danger-triangle-linear"
                            className="shrink-0 mt-0.5 text-signal"
                          />
                          <span>
                            {interactions.note ??
                              "Some pairs in this stack have no interaction data on file. That does not mean the combination is safe."}
                          </span>
                        </p>
                      </div>
                    )}

                    {!interactions || !interactions.pairs || interactions.pairs.length === 0 ? (
                      <p className="text-xs text-faint italic">
                        {knownCount < 2
                          ? "A stack needs two compounds the registry knows about before there is a pair to read. An empty table here is not a statement about safety."
                          : "No pairs came back for this stack. That is missing data, not an all-clear, and it must not be read as one."}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {interactions.pairs.map((pair) => (
                          <InteractionRow
                            key={`${pair.compound_a_id}-${pair.compound_b_id}`}
                            pair={pair}
                          />
                        ))}
                      </div>
                    )}
                  </Panel>

                  {/* disclaimer */}
                  <Panel className="p-5 sm:p-6 border-line">
                    <h2 className="eyebrow mb-2 flex items-center gap-1.5">
                      <Icon icon="solar:info-circle-linear" /> Read this
                    </h2>
                    <p className="text-xs text-muted leading-relaxed">
                      This report is education, not medical advice. It is not a prescription, it is
                      not a diagnosis, and it is not a substitute for a clinician who knows your
                      history. PepHouse reports what is on file and what is missing. A compound with
                      no evidence on file is not thereby safe, and a compound with completed trials
                      behind it is not thereby safe for you. Talk to a licensed clinician before you
                      start, change, or stop anything.
                    </p>
                  </Panel>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
