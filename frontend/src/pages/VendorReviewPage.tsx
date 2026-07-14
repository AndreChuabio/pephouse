import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { Panel } from "../components/ui/Panel";
import { PanelHeader } from "../components/ui/PanelHeader";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { fetchPendingSubmissions, reviewSubmission } from "../lib/pephouse";
import type { PendingSubmission } from "../lib/pephouse";

// The operator review queue. Used on a phone, standing at a conference booth,
// between conversations. Two decisions per row and nothing in the way of them.
//
// The one rule this screen has to hold: everything on a submission is a CLAIM.
// A vendor telling us it is third-party tested is not a test.
//
// What publishing actually does, because the operator is deciding on it:
//
//   - It attaches the submission to a vendor row in the public directory,
//     creating that row only if no vendor of the same name exists already
//     (backend/vendors.py:review does an ilike match before it inserts).
//   - The claims go public WITH it. _published_claims() selects exactly the
//     rows an operator published, and get_breakdown() returns them to the
//     public as vendor_claims[] — the COA link, the named labs, and the
//     testing and GMP answers all appear on the vendor's public record.
//   - A claimed third-party test moves the vendor from "nothing on file" to
//     "vendor claim" in the public index (_testing_status). It can never reach
//     "independent" this way. Only a real assay in vendor_lab_results does
//     that, and the backend deliberately does not copy the claim onto
//     vendors.third_party_tested, where it would read as a fact.
//
// So publishing is not identity-only, and this screen must not imply it is.
// The claim becomes visible, labelled as a claim. The UI says all of that where
// the decision is made, not in a footnote.

type ReviewAction = "published" | "rejected";

/** What the page is doing, as one value rather than four booleans. */
type QueueState =
  | { kind: "loading" }
  | { kind: "ready" }
  /** Signed in, but this account is not on the operator allowlist. */
  | { kind: "forbidden" }
  /** No durable session at all: the backend cannot even see who is asking. */
  | { kind: "signed_out" }
  | { kind: "error"; message: string };

interface ActionResult {
  id: number;
  vendorName: string;
  action: ReviewAction;
  kind: "vendor" | "member";
}

interface RowError {
  id: number;
  message: string;
}

const SOURCE_LABEL: Record<string, string> = {
  compounding_pharmacy: "Compounding pharmacy",
  vendor_tested: "Gray-market, vendor-tested",
  gray_market: "Gray-market, untested",
  research_chem: "Research chemical",
  brand: "Brand / pharma-grade",
};

const SUBMITTER_LABEL: Record<string, string> = {
  vendor: "Submitted by the vendor",
  member: "Submitted by a member",
  operator: "Entered by an operator",
};

/** How a buyer's sentiment renders. Still one purchaser's opinion, never a result. */
const SENTIMENT: Record<string, { label: string; tone: string; icon: string }> = {
  positive: { label: "Positive experience", tone: "text-emerald-300", icon: "solar:like-linear" },
  neutral: { label: "Neutral experience", tone: "text-zinc-300", icon: "solar:minus-circle-linear" },
  negative: { label: "Negative experience", tone: "text-red-300", icon: "solar:dislike-linear" },
};

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

// apiJson throws with the backend's body text, not a status code, so the two
// auth outcomes are told apart by what FastAPI puts in `detail`
// (backend/auth.py: 403 "not permitted", 401 "authentication required").
function isForbidden(message: string): boolean {
  return /not permitted|forbidden|\b403\b/i.test(message);
}

function isUnauthenticated(message: string): boolean {
  return /authentication required|invalid or expired session|\b401\b/i.test(message);
}

/** Render a submitted URL as a link only if it is really http(s). */
function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// A contact channel is usually a handle (@name) or a phone number, not a URL.
// Only linkify what actually looks like a web address; leave handles as text.
function channelHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(" ") || trimmed.startsWith("@")) return null;
  if (trimmed.includes("://") || /\.[a-z]{2,}(\/|$)/i.test(trimmed)) return safeUrl(trimmed);
  return null;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "time unknown";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "time unknown";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** A reported dollar amount, or null when there is nothing usable to show. */
function formatUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** An identity field. Missing here is thin, not alarming. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const shown = value === null || value === undefined || value.trim() === "" ? null : value.trim();
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600">{label}</p>
      <p className={`text-sm truncate ${shown ? "text-zinc-200" : "text-zinc-600 italic"}`}>
        {shown ?? "not given"}
      </p>
    </div>
  );
}

/** A claim line. Missing here is a FINDING and reads as one. */
function ClaimLine({
  label,
  state = "claimed",
  children,
}: {
  label: string;
  state?: "claimed" | "denied" | "missing";
  children?: ReactNode;
}) {
  const tone =
    state === "claimed"
      ? "text-amber-400"
      : state === "denied"
        ? "text-zinc-300"
        : "text-orange-400";
  const icon =
    state === "claimed"
      ? "solar:chat-square-like-linear"
      : state === "denied"
        ? "solar:close-circle-linear"
        : "solar:question-circle-linear";
  return (
    <div className="flex items-start gap-2.5">
      <Icon icon={icon} className={`${tone} text-base mt-0.5 shrink-0`} />
      <div className="min-w-0">
        <p className={`text-sm ${tone}`}>{label}</p>
        {children}
      </div>
    </div>
  );
}

/** How a channel-only vendor is reached. Rendered whenever any channel is present. */
function ContactChannels({
  telegram,
  whatsapp,
  other,
}: {
  telegram: string;
  whatsapp: string;
  other: string;
}) {
  const rows = [
    { key: "telegram", label: "Telegram", icon: "solar:plain-2-linear", value: telegram },
    { key: "whatsapp", label: "WhatsApp", icon: "solar:chat-round-line-linear", value: whatsapp },
    { key: "other", label: "Other channel", icon: "solar:link-round-linear", value: other },
  ].filter((row) => row.value.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1.5">Contact channels</p>
      <div className="space-y-1.5">
        {rows.map((row) => {
          const href = channelHref(row.value);
          return (
            <div key={row.key} className="flex items-center gap-2 min-w-0">
              <Icon icon={row.icon} className="text-zinc-500 text-sm shrink-0" />
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-widest text-zinc-600">
                {row.label}
              </span>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 break-all text-sm text-blue-400 hover:underline"
                >
                  {row.value}
                </a>
              ) : (
                <span className="min-w-0 break-all font-mono text-sm text-zinc-200">
                  {row.value}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        How a channel-only vendor is reached. A handle is not a website and is not verified.
      </p>
    </div>
  );
}

/** The screen a non-operator gets. Plain, and not a broken page. */
function Locked({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-8 z-10">
      <div className="max-w-md mx-auto mt-10">
        <Panel className="p-6">
          <PanelHeader icon="solar:lock-keyhole-minimalistic-linear" title={title} />
          <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
          {action ? <div className="mt-5">{action}</div> : null}
        </Panel>
      </div>
    </div>
  );
}

export default function VendorReviewPage() {
  useDocumentTitle("PepHouse | Review queue");
  const { isAnonymous, email, signInWithGoogle } = useAuth();

  const [state, setState] = useState<QueueState>({ kind: "loading" });
  const [rows, setRows] = useState<PendingSubmission[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<{ id: number; action: ReviewAction } | null>(null);
  /** Publish and reject both take two taps: a mispublish is public. */
  const [armed, setArmed] = useState<{ id: number; action: ReviewAction } | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (isAnonymous) {
      setState({ kind: "signed_out" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const pending = await fetchPendingSubmissions();
      setRows(pending);
      setState({ kind: "ready" });
    } catch (err) {
      const message = errorText(err);
      if (isForbidden(message)) setState({ kind: "forbidden" });
      else if (isUnauthenticated(message)) setState({ kind: "signed_out" });
      else setState({ kind: "error", message });
    }
  }, [isAnonymous]);

  useEffect(() => {
    void load();
  }, [load]);

  // Disarm on its own so a button left armed in a pocket does not fire later.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const act = useCallback(
    async (submission: PendingSubmission, action: ReviewAction): Promise<void> => {
      const index = rows.findIndex((row) => row.id === submission.id);
      const note = (notes[submission.id] ?? "").trim();

      setBusy({ id: submission.id, action });
      setRowError(null);
      setArmed(null);
      // Optimistic: the row leaves the queue immediately, which is the point of
      // this screen. It comes back, in place, if the write fails.
      setRows((prev) => prev.filter((row) => row.id !== submission.id));

      try {
        await reviewSubmission(submission.id, action, note.length > 0 ? note : undefined);
        setNotes((prev) => {
          const next = { ...prev };
          delete next[submission.id];
          return next;
        });
        setResult({
          id: submission.id,
          vendorName: submission.vendor_name,
          action,
          kind: submission.submission_kind === "member" ? "member" : "vendor",
        });
      } catch (err) {
        setRows((prev) => {
          if (prev.some((row) => row.id === submission.id)) return prev;
          const next = prev.slice();
          const at = index >= 0 ? Math.min(index, next.length) : next.length;
          next.splice(at, 0, submission);
          return next;
        });
        setRowError({ id: submission.id, message: errorText(err) });
      } finally {
        setBusy(null);
      }
    },
    [notes, rows],
  );

  if (state.kind === "signed_out") {
    return (
      <AppShell>
        <Header count={null} onRefresh={null} email={email} />
        <Locked
          title="Operator sign-in required"
          body="The review queue is an internal surface. Sign in with the operator account to open it."
          action={
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full py-3 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-sm font-medium hover:bg-blue-500/25 transition-colors"
            >
              Sign in with Google
            </button>
          }
        />
      </AppShell>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <AppShell>
        <Header count={null} onRefresh={null} email={email} />
        <Locked
          title="Not an operator account"
          body={`This screen is limited to the operator allowlist, and ${
            email ?? "this account"
          } is not on it. Nothing is broken. If you should have access, add the address to ADMIN_EMAILS on the backend and sign in again.`}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Header
        count={state.kind === "ready" ? rows.length : null}
        onRefresh={() => void load()}
        email={email}
      />

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6 z-10">
        <div className="max-w-2xl mx-auto space-y-4">
          {result ? (
            <div
              className={`rounded-lg border px-4 py-3 flex items-start gap-2.5 ${
                result.action === "published"
                  ? "bg-emerald-500/10 border-emerald-500/25"
                  : "bg-zinc-800/50 border-zinc-700"
              }`}
            >
              <Icon
                icon={
                  result.action === "published"
                    ? "solar:global-linear"
                    : "solar:trash-bin-minimalistic-linear"
                }
                className={`text-base mt-0.5 shrink-0 ${
                  result.action === "published" ? "text-emerald-400" : "text-zinc-400"
                }`}
              />
              <p className="text-sm text-zinc-200 flex-1">
                {result.action === "published" ? (
                  result.kind === "member" ? (
                    <>
                      <span className="font-medium">{result.vendorName}</span> is published. This
                      buyer report is now on its public record, labelled as an unverified buyer
                      report. Nothing here was recorded as an independent assay.
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{result.vendorName}</span> is published. Its
                      identity is in the public directory, and this submission's claims are now on
                      its public record, labelled as claims. Nothing here was recorded as an
                      independent assay.
                    </>
                  )
                ) : (
                  <>
                    <span className="font-medium">{result.vendorName}</span> is rejected. Nothing
                    from this submission is published.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="text-zinc-500 hover:text-zinc-200 shrink-0"
                aria-label="Dismiss"
              >
                <Icon icon="solar:close-circle-linear" />
              </button>
            </div>
          ) : null}

          {state.kind === "loading" ? (
            <Panel className="p-6 flex items-center gap-3">
              <span className="h-4 w-4 rounded-full border-2 border-zinc-700 border-t-blue-400 animate-spin" />
              <span className="text-sm text-zinc-400">Loading the queue</span>
            </Panel>
          ) : null}

          {state.kind === "error" ? (
            <Panel className="p-6">
              <PanelHeader icon="solar:danger-triangle-linear" title="The queue did not load" />
              <p className="text-sm text-zinc-400 break-words">{state.message}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-4 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Try again
              </button>
            </Panel>
          ) : null}

          {state.kind === "ready" && rows.length === 0 ? (
            <Panel className="p-8 text-center">
              <Icon
                icon="solar:inbox-line-linear"
                className="text-3xl text-zinc-700 mx-auto mb-3"
              />
              <p className="text-sm text-zinc-300">Nothing pending</p>
              <p className="text-xs text-zinc-500 mt-1">
                Every submission collected so far has been reviewed.
              </p>
            </Panel>
          ) : null}

          {state.kind === "ready" && rows.length > 0 ? (
            <p className="text-xs text-zinc-500 px-1">
              Nothing below is public. Every field on these cards is what the submitter told us, and
              publishing does not turn any of it into a tested result.
            </p>
          ) : null}

          {rows.map((submission) => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              note={notes[submission.id] ?? ""}
              onNote={(value) =>
                setNotes((prev) => ({ ...prev, [submission.id]: value }))
              }
              busy={busy !== null && busy.id === submission.id ? busy.action : null}
              disabled={busy !== null && busy.id !== submission.id}
              armed={armed?.id === submission.id ? armed.action : null}
              onArm={(action) => setArmed({ id: submission.id, action })}
              onAct={(action) => void act(submission, action)}
              error={rowError?.id === submission.id ? rowError.message : null}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Header({
  count,
  onRefresh,
  email,
}: {
  count: number | null;
  onRefresh: (() => void) | null;
  email: string | null;
}) {
  return (
    <div className="h-16 flex items-center justify-between gap-3 px-4 sm:px-8 border-b border-zinc-800/60 shrink-0 z-10">
      <h1 className="text-sm font-medium text-white tracking-tight flex items-center gap-2 min-w-0">
        <Icon icon="solar:clipboard-check-linear" className="text-blue-500 shrink-0" />
        <span className="truncate">Review queue</span>
        {count !== null ? (
          <span className="text-[10px] uppercase tracking-widest text-zinc-500 shrink-0">
            {count} pending
          </span>
        ) : null}
      </h1>
      <div className="flex items-center gap-3 shrink-0">
        {email ? (
          <span className="hidden sm:block text-xs text-zinc-600 truncate max-w-[180px]">
            {email}
          </span>
        ) : null}
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
            aria-label="Refresh the queue"
          >
            <Icon icon="solar:refresh-linear" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface SubmissionCardProps {
  submission: PendingSubmission;
  note: string;
  onNote: (value: string) => void;
  /** The action currently in flight for this row, or null. */
  busy: ReviewAction | null;
  /** Another row is mid-flight: this one is inert until that settles. */
  disabled: boolean;
  armed: ReviewAction | null;
  onArm: (action: ReviewAction) => void;
  onAct: (action: ReviewAction) => void;
  error: string | null;
}

function SubmissionCard({
  submission,
  note,
  onNote,
  busy,
  disabled,
  armed,
  onArm,
  onAct,
  error,
}: SubmissionCardProps) {
  const website = safeUrl(submission.website);
  const coa = safeUrl(submission.coa_url);
  // test_labs is free-text jsonb off a submission form: it can arrive null, as a
  // non-array, or holding blanks, untrimmed strings, and repeats. Repeats would
  // collide as React keys, so they are collapsed here.
  const rawLabs: unknown = submission.test_labs;
  const labs = Array.from(
    new Set(
      (Array.isArray(rawLabs) ? rawLabs : [])
        .filter((lab): lab is string => typeof lab === "string")
        .map((lab) => lab.trim())
        .filter((lab) => lab.length > 0),
    ),
  );
  const sourceType = submission.source_type ?? null;
  const sourceLabel = sourceType ? (SOURCE_LABEL[sourceType] ?? sourceType) : null;
  const submittedBy = submission.submitted_by ?? null;
  const submitterLabel = submittedBy
    ? (SUBMITTER_LABEL[submittedBy] ?? `Submitted by ${submittedBy}`)
    : "Submitter type not recorded";
  const tested = submission.third_party_tested;
  const gmp = submission.gmp_certified;
  const locked = busy !== null || disabled;

  const isMember = submission.submission_kind === "member";
  const telegram = (submission.telegram ?? "").trim();
  const whatsapp = (submission.whatsapp ?? "").trim();
  const contactOther = (submission.contact_other ?? "").trim();

  // Buyer-report fields. Every one of these is one purchaser's word.
  const reportCompound =
    typeof submission.report_compound_id === "number" &&
    Number.isFinite(submission.report_compound_id)
      ? `Compound #${submission.report_compound_id}`
      : null;
  const reportCost = formatUsd(submission.report_cost_usd);
  const sentiment = submission.report_sentiment
    ? (SENTIMENT[submission.report_sentiment] ?? null)
    : null;
  const batchTested = submission.report_batch_lab_tested;

  const press = (action: ReviewAction): void => {
    if (locked) return;
    if (armed === action) onAct(action);
    else onArm(action);
  };

  return (
    <Panel className={`p-4 sm:p-5 ${disabled ? "opacity-50" : ""}`}>
      <PanelHeader
        icon={isMember ? "solar:user-rounded-linear" : "solar:shop-2-linear"}
        title={submission.vendor_name}
        action={
          <span className="text-[10px] uppercase tracking-widest text-zinc-600 shrink-0">
            #{submission.id} · {timeAgo(submission.created_at)}
          </span>
        }
      />

      {/* The kind decides what the fields below mean. A buyer report is a lower
          grade of information than a vendor's own claim, and neither is a test. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            isMember
              ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
          }`}
        >
          <Icon
            icon={isMember ? "solar:user-rounded-linear" : "solar:shop-2-linear"}
            className="text-sm"
          />
          {isMember ? "Buyer report" : "Vendor claim"}
        </span>
        <span className="text-[11px] text-zinc-600">
          {isMember
            ? "the lowest grade of information, unverified"
            : "a self-disclosure, not a measurement"}
        </span>
      </div>

      {isMember ? (
        /* A buyer report: what one purchaser told us about a vendor they used. It
           is the lowest grade of information on file and is never a test. */
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] p-3.5 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-sky-400/80">
            Buyer report, unverified, the lowest grade of information on file
          </p>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Compound</p>
              <p className={`text-sm ${reportCompound ? "text-zinc-200" : "text-zinc-600 italic"}`}>
                {reportCompound ?? "not specified"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600">Reported cost</p>
              <p className={`text-sm ${reportCost ? "text-zinc-200" : "text-zinc-600 italic"}`}>
                {reportCost ?? "not given"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Sentiment</p>
            {sentiment ? (
              <span className={`inline-flex items-center gap-1.5 text-sm ${sentiment.tone}`}>
                <Icon icon={sentiment.icon} className="text-base" />
                {sentiment.label}
              </span>
            ) : (
              <p className="text-sm text-zinc-600 italic">not given</p>
            )}
          </div>

          {batchTested === true ? (
            <ClaimLine label="Buyer says this batch was lab-tested">
              <p className="text-xs text-zinc-500 mt-0.5">
                The buyer's word, not an assay. Publishing files this as an unverified buyer report
                and loads no independent result.
              </p>
            </ClaimLine>
          ) : batchTested === false ? (
            <ClaimLine label="Buyer says this batch was not lab-tested" state="denied" />
          ) : (
            <ClaimLine label="No answer on whether the batch was lab-tested" state="missing">
              <p className="text-xs text-zinc-500 mt-0.5">
                Left blank. That is a finding, not a pass.
              </p>
            </ClaimLine>
          )}
        </div>
      ) : (
        <>
          {/* Self-reported too, including the source type: "Gray-market, vendor-tested"
              is the submitter's own answer, not a category we checked. Saying so here
              keeps the boundary honest, rather than implying only the amber box below
              holds claims. */}
          <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
            Identity, as given by the submitter
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Manufacturer" value={submission.manufacturer} />
            <Field label="Country" value={submission.country} />
            <Field label="Source type" value={sourceLabel} />
          </div>

          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600">Website</p>
            {website ? (
              <a
                href={website}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-blue-400 hover:underline break-all inline-flex items-center gap-1"
              >
                {website}
                <Icon icon="solar:arrow-right-up-linear" className="text-xs shrink-0" />
              </a>
            ) : (
              <p className="text-sm text-zinc-600 italic">
                {submission.website ? "given, but not a usable http address" : "not given"}
              </p>
            )}
          </div>

          {/* Everything below is what the submitter says about itself. */}
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-amber-500/80">
              Claimed by the submitter, not verified
            </p>

            {tested === true ? (
              <ClaimLine label="Claims it is third-party tested">
                <p className="text-xs text-zinc-500 mt-0.5">
                  A claim, not an assay. Publishing does not badge this vendor as tested: the
                  directory grades it as a vendor claim, never as an independent result. It stays
                  graded that way until a real third-party assay is loaded, which this decision does
                  not do.
                </p>
              </ClaimLine>
            ) : tested === false ? (
              <ClaimLine label="States it is not third-party tested" state="denied" />
            ) : (
              <ClaimLine label="No answer on third-party testing" state="missing">
                <p className="text-xs text-zinc-500 mt-0.5">
                  The question was left blank. That is a finding, not a pass.
                </p>
              </ClaimLine>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Named labs</p>
              {labs.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {labs.map((lab) => (
                    <span
                      key={lab}
                      className="px-2 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-300 border border-zinc-700"
                    >
                      {lab}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-orange-400">No lab named</p>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">
                Certificate of analysis
              </p>
              {coa ? (
                <>
                  <a
                    href={coa}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 hover:bg-zinc-700 transition-colors"
                  >
                    <Icon icon="solar:document-text-linear" className="text-zinc-400" />
                    Open the COA
                    <Icon icon="solar:arrow-right-up-linear" className="text-xs text-zinc-500" />
                  </a>
                  <p className="text-xs text-zinc-500 mt-1.5">
                    A document the vendor chose to show us. Check the lab, the date, and that the
                    batch matches before you treat it as anything.
                  </p>
                </>
              ) : (
                <p className="text-sm text-orange-400">
                  {submission.coa_url
                    ? "COA link given, but not a usable http address"
                    : "No COA on file"}
                </p>
              )}
            </div>

            {gmp === true ? (
              <ClaimLine label="Claims GMP certification" />
            ) : gmp === false ? (
              <ClaimLine label="States it is not GMP certified" state="denied" />
            ) : (
              <ClaimLine label="No answer on GMP certification" state="missing" />
            )}
          </div>
        </>
      )}

      <ContactChannels telegram={telegram} whatsapp={whatsapp} other={contactOther} />

      <div className="mt-4 space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Who submitted this</p>
          <p className="text-sm text-zinc-200">{submitterLabel}</p>
          {submission.submitter_ref ? (
            <p className="text-[11px] font-mono text-zinc-600 break-all">
              {submission.submitter_ref}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-600 italic">no submitter ref recorded</p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Notes from submitter</p>
          {submission.notes && submission.notes.trim().length > 0 ? (
            <p className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
              {submission.notes}
            </p>
          ) : (
            <p className="text-sm text-zinc-600 italic">none</p>
          )}
        </div>
      </div>

      <label className="block mt-4">
        <span className="text-[10px] uppercase tracking-widest text-zinc-600">
          Review note, optional
        </span>
        <textarea
          value={note}
          onChange={(event) => onNote(event.target.value)}
          disabled={locked}
          rows={2}
          placeholder="What you saw, what you asked, what to check later"
          className="mt-1 w-full rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 resize-none"
        />
      </label>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-300 break-words">
            The review did not save, so this row is back in the queue. {error}
          </p>
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3.5 space-y-2">
        <p className="flex items-start gap-2 text-xs text-zinc-400">
          <Icon icon="solar:global-linear" className="text-zinc-500 text-sm mt-0.5 shrink-0" />
          <span>
            Publishing puts{" "}
            <span className="text-zinc-200">{submission.vendor_name}</span> in the public directory,
            attaching it to an existing vendor of that name or creating the row if there is none. It
            goes live immediately.
          </span>
        </p>
        {isMember ? (
          <>
            <p className="text-xs text-zinc-500 pl-6">
              This buyer report goes public with it, rendered as an unverified buyer report, the
              lowest grade of information on the vendor's record.
            </p>
            <p className="text-xs text-zinc-500 pl-6">
              It is not an assay and does not change the vendor's testing grade. A buyer saying a
              batch was lab-tested is not a lab result.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-zinc-500 pl-6">
              The claims above go public with it, rendered as claims: the COA link, the named labs,
              and the testing and GMP answers all appear on the vendor's public record.
            </p>
            <p className="text-xs text-zinc-500 pl-6">
              {tested === true
                ? "Because it claims third-party testing, the directory will move it from nothing on file to vendor claim. It cannot reach independent this way."
                : "It carries no independent assay, so the directory will show it with nothing on file until a real third-party result is loaded."}
            </p>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => press("published")}
          disabled={locked}
          className={`h-14 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
            armed === "published"
              ? "bg-emerald-500 text-zinc-950 border border-emerald-400"
              : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
          }`}
        >
          {busy === "published" ? (
            <span className="h-4 w-4 rounded-full border-2 border-emerald-900/40 border-t-emerald-300 animate-spin" />
          ) : (
            <Icon icon="solar:check-circle-linear" className="text-base" />
          )}
          {busy === "published"
            ? "Publishing"
            : armed === "published"
              ? "Confirm, make it public"
              : "Publish"}
        </button>

        <button
          type="button"
          onClick={() => press("rejected")}
          disabled={locked}
          className={`h-14 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
            armed === "rejected"
              ? "bg-red-500 text-zinc-950 border border-red-400"
              : "bg-red-500/10 text-red-300 border border-red-500/25 hover:bg-red-500/20"
          }`}
        >
          {busy === "rejected" ? (
            <span className="h-4 w-4 rounded-full border-2 border-red-900/40 border-t-red-300 animate-spin" />
          ) : (
            <Icon icon="solar:close-circle-linear" className="text-base" />
          )}
          {busy === "rejected" ? "Rejecting" : armed === "rejected" ? "Confirm reject" : "Reject"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-zinc-600 text-center">
        {armed
          ? "Tap again to commit. This clears itself in a few seconds."
          : "Each action takes two taps."}
      </p>
    </Panel>
  );
}
