import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { Panel } from "../components/ui/Panel";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  fetchIntakes,
  type Eligibility,
  type TrialIntakeRow,
} from "../lib/consult";

// Read-only coordinator queue over GET /consult/intakes. Each row is a trial
// referral captured after a consult: goal, compound, eligibility read + reason,
// consent, status, and the PHI-minimized context snapshot the coordinator needs
// for triage. No raw lab values reach this surface (the backend minimizes them).

const ELIGIBILITY_BADGE: Record<Eligibility, { label: string; className: string }> = {
  eligible: {
    label: "Eligible",
    className: "bg-measured/10 text-measured border border-measured/30",
  },
  excluded: {
    label: "Excluded",
    className: "bg-danger/10 text-danger border border-danger/30",
  },
  no_trial: {
    label: "No trial",
    className: "bg-signal/10 text-signal border border-signal/30",
  },
  unknown: {
    label: "Unknown",
    className: "bg-surface-2 text-muted border border-line",
  },
};

function eligibilityBadge(value: string): { label: string; className: string } {
  return ELIGIBILITY_BADGE[value as Eligibility] ?? ELIGIBILITY_BADGE.unknown;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function snapshotLines(snapshot: Record<string, unknown> | null): string[] {
  if (!snapshot) return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined || value === "") continue;
    const rendered = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    lines.push(`${key}: ${rendered}`);
  }
  return lines;
}

export default function CoordinatorPage() {
  useDocumentTitle("PepHouse | Coordinator");

  const [rows, setRows] = useState<TrialIntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchIntakes();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not load intakes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <header className="h-16 flex items-center justify-between px-8 border-b border-line/60 shrink-0 z-10 bg-base/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-display font-semibold tracking-tight text-ink flex items-center gap-2">
            <Icon icon="solar:clipboard-list-linear" className="text-signal text-xl" />
            Coordinator
          </h1>
          <div className="h-4 w-px bg-line" />
          <div className="readout flex items-center gap-2 text-xs font-medium text-muted bg-surface border border-line px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-signal" />
            {rows.length} intake{rows.length === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-xs font-medium text-muted hover:text-ink transition-colors flex items-center gap-1.5 disabled:opacity-60"
        >
          <Icon icon="solar:refresh-linear" className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {error && (
          <Panel className="p-4 mb-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-danger">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="text-xs font-medium text-muted hover:text-ink border border-line hover:border-line-bright rounded px-2 py-1 transition-colors disabled:opacity-60 shrink-0"
              >
                Retry
              </button>
            </div>
          </Panel>
        )}

        {loading && rows.length === 0 ? (
          <p className="text-sm text-faint">Loading intake queue…</p>
        ) : error && rows.length === 0 ? null : rows.length === 0 ? (
          <Panel className="p-8">
            <div className="flex flex-col items-center text-center gap-2">
              <Icon icon="solar:inbox-linear" className="text-3xl text-faint" />
              <p className="text-ink font-display font-medium tracking-tight">No intakes yet</p>
              <p className="text-sm text-faint max-w-sm">
                Trial referrals captured after a consult land here for coordinator review.
              </p>
            </div>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {rows.map((row) => {
              const badge = eligibilityBadge(row.eligibility);
              const snapshot = snapshotLines(row.context_snapshot);
              return (
                <Panel key={row.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-display font-medium tracking-tight text-ink truncate">
                        {row.compound_name ?? "Unspecified compound"}
                      </p>
                      <p className="text-xs text-faint truncate">
                        {row.goal ?? "No stated goal"}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {row.eligibility_reason && (
                    <p className="text-xs text-muted leading-snug border-l-2 border-line pl-2">
                      {row.eligibility_reason}
                    </p>
                  )}

                  {row.counsel_summary && (
                    <p className="text-xs text-muted leading-snug">
                      {row.counsel_summary}
                    </p>
                  )}

                  {snapshot.length > 0 && (
                    <div className="rounded-lg border border-line/80 bg-surface-2 px-3 py-2">
                      <p className="eyebrow mb-1">
                        Context snapshot
                      </p>
                      <ul className="space-y-0.5">
                        {snapshot.map((line, i) => (
                          <li
                            key={`${row.id}-snap-${i}`}
                            className="readout text-[11px] text-muted leading-snug break-words"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-line/60 text-[11px] text-faint">
                    <span className="flex items-center gap-1.5">
                      <Icon
                        icon={
                          row.consent
                            ? "solar:check-circle-linear"
                            : "solar:close-circle-linear"
                        }
                        className={row.consent ? "text-measured" : "text-faint"}
                      />
                      {row.consent ? "Consented" : "No consent"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="uppercase tracking-wider">
                        {row.status ?? "submitted"}
                      </span>
                      <span className="text-ghost">·</span>
                      <span className="readout">{formatWhen(row.created_at)}</span>
                    </span>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
