import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Panel } from "../components/ui/Panel";
import { PanelHeader } from "../components/ui/PanelHeader";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  fetchVendor,
  fetchVendors,
  submitVendor,
  type IndependentAssay,
  type MemberReport,
  type SafetyAxis,
  type SourcingRow,
  type TestedAxes,
  type TestingStatus,
  type VendorBreakdown,
  type VendorClaim,
  type VendorSubmissionInput,
  type VendorSummary,
} from "../lib/pephouse";

// The public vendor index.
//
// The whole point of this surface is that the three testing grades never blur
// into one another:
//
//   independent  a third-party lab actually measured the product. Evidence.
//   vendor_claim the vendor said so about itself. Not evidence.
//   none         nothing on file. This is a FINDING and is rendered as one,
//                never as a blank cell or a grey dash.
//
// Every nullable boolean coming off the backend is rendered tri-state. A null
// endotoxin result is "not tested", never "clean". Absence of data is never
// dressed up as a pass.
//
// "Tested" is also not a boolean, and this is the trap the page works hardest to
// avoid. A grey-market COA is nearly always purity plus identity — the axis that
// barely moves across the whole market. The axes that actually put people in
// hospital (endotoxin, heavy metals, sterility) are the ones nobody publishes.
// So an "Independent assay" badge is never allowed to stand on its own: wherever
// it appears, the axes that assay never covered appear next to it. A vendor that
// proved the safe thing and skipped the dangerous ones must not read as safe.

const NOT_ON_FILE = "Not on file";

const SOURCE_LABEL: Record<string, string> = {
  compounding_pharmacy: "Compounding pharmacy",
  vendor_tested: "Gray-market, vendor-tested",
  gray_market: "Gray-market, untested",
  research_chem: "Research chemical",
  brand: "Brand / pharma-grade",
};

interface TestingStatusMeta {
  /** Plain words. "none" gets a sentence, not a dash. */
  label: string;
  icon: string;
  badge: string;
  /** Hatched fill marks an absence of data rather than a value. */
  hatched: boolean;
  blurb: string;
}

const TESTING_STATUS: Record<TestingStatus, TestingStatusMeta> = {
  independent: {
    label: "Independent assay",
    icon: "solar:verified-check-bold",
    badge: "bg-measured/10 text-measured border-measured/30",
    hatched: false,
    blurb:
      "A third-party lab measured the product. This is the only thing on this page that counts as evidence.",
  },
  vendor_claim: {
    label: "Vendor claim, no assay",
    icon: "solar:chat-round-unread-linear",
    badge: "bg-signal/10 text-signal border-signal/30 border-dashed",
    hatched: false,
    blurb:
      "The vendor claims it is tested. No independent assay is on file. A claim is not a result.",
  },
  none: {
    label: "No testing data on file",
    icon: "solar:file-corrupted-linear",
    badge: "bg-surface text-faint border-line border-dashed",
    hatched: true,
    blurb:
      "Nothing has been measured and nothing has been claimed. This is the most common case in the index.",
  },
};

const TESTING_ORDER: TestingStatus[] = ["independent", "vendor_claim", "none"];

/**
 * An unrecognised grade off the wire falls back to "none" — the most
 * conservative reading. Nothing unknown is ever promoted to evidence.
 */
function statusMeta(status: TestingStatus | null | undefined): TestingStatusMeta {
  return (status !== null && status !== undefined && TESTING_STATUS[status]) || TESTING_STATUS.none;
}

/** The six axes an assay can cover, in the order a report reads them. */
const AXIS_ORDER: (keyof TestedAxes)[] = [
  "purity",
  "identity",
  "potency",
  "endotoxin",
  "heavy_metals",
  "sterility",
];

const AXIS_LABEL: Record<keyof TestedAxes, string> = {
  purity: "Purity",
  identity: "Identity",
  potency: "Potency",
  endotoxin: "Endotoxin",
  heavy_metals: "Heavy metals",
  sterility: "Sterility",
};

/** The three axes a purity certificate does not cover, and that harm people. */
const SAFETY_AXES: SafetyAxis[] = ["endotoxin", "heavy_metals", "sterility"];

const EMPTY_AXES: TestedAxes = {
  purity: false,
  identity: false,
  potency: false,
  endotoxin: false,
  heavy_metals: false,
  sterility: false,
};

/** Never trust the payload to carry every axis. A missing axis is an untested one. */
function axes(value: TestedAxes | null | undefined): TestedAxes {
  if (value === null || value === undefined) return EMPTY_AXES;
  return {
    purity: value.purity === true,
    identity: value.identity === true,
    potency: value.potency === true,
    endotoxin: value.endotoxin === true,
    heavy_metals: value.heavy_metals === true,
    sterility: value.sterility === true,
  };
}

/**
 * The safety axes with no result on file. Recomputed from tested_axes rather
 * than trusting safety_gap, so a dropped or truncated array can never shrink
 * the gap and make a vendor look better tested than it is.
 */
function safetyGap(value: TestedAxes | null | undefined): SafetyAxis[] {
  const covered = axes(value);
  return SAFETY_AXES.filter((axis) => !covered[axis]);
}

/** A single assay's own coverage. Mirrors the backend: a null column is untested. */
function assayAxes(assay: IndependentAssay): TestedAxes {
  const has = (value: boolean | null | undefined): boolean =>
    value !== null && value !== undefined;
  return {
    purity: num(assay.purity_pct) !== null,
    identity: has(assay.identity_verified),
    potency: num(assay.potency_factor) !== null,
    endotoxin: has(assay.endotoxin_detected),
    heavy_metals: has(assay.heavy_metals_detected),
    sterility: has(assay.sterility_pass),
  };
}

function axisList(gap: SafetyAxis[]): string {
  const names = gap.map((axis) => AXIS_LABEL[axis].toLowerCase());
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// ------------------------------------------------------------------- helpers

function text(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : NOT_ON_FILE;
}

function isMissing(value: string | null | undefined): boolean {
  return (value ?? "").trim().length === 0;
}

/** A usable href, or null. Keeps `as string` casts out of the JSX. */
function link(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sourceLabel(value: string | null | undefined): string {
  const key = (value ?? "").trim();
  if (key.length === 0) return NOT_ON_FILE;
  return SOURCE_LABEL[key] ?? key;
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pct(value: number | null | undefined): string {
  const n = num(value);
  return n === null ? NOT_ON_FILE : `${n}%`;
}

function mg(value: number | null | undefined): string {
  const n = num(value);
  return n === null ? NOT_ON_FILE : `${n} mg`;
}

function usd(value: number | null | undefined): string {
  const n = num(value);
  return n === null ? NOT_ON_FILE : `$${n.toFixed(2)}`;
}

function whenText(iso: string | null | undefined): string {
  const raw = link(iso);
  if (raw === null) return NOT_ON_FILE;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function compoundLabel(compoundId: number | null): string {
  const n = num(compoundId);
  return n === null ? "Compound not recorded" : `Compound #${n}`;
}

type Tone = "good" | "bad" | "unknown";

/** null is its own answer. It never collapses into the good branch. */
function triTone(value: boolean | null | undefined, goodWhen: boolean): Tone {
  if (value === null || value === undefined) return "unknown";
  return value === goodWhen ? "good" : "bad";
}

// ---------------------------------------------------------------- primitives

function Missing({ children }: { children?: ReactNode }) {
  return (
    <span className="text-faint border-b border-dashed border-line">
      {children ?? NOT_ON_FILE}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="eyebrow !text-[10px]">{label}</span>
      <span className="text-sm text-ink break-words">{children}</span>
    </div>
  );
}

function TextFact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Fact label={label}>{isMissing(value) ? <Missing /> : text(value)}</Fact>
  );
}

/**
 * Source type, mapped through its lookup. The raw value is tested for presence,
 * never the resolved label — otherwise a missing source type would arrive here
 * already rendered as the words "Not on file" and be shown as if it were a real
 * value, in ordinary body text, with none of the marks that flag an absence.
 */
function SourceFact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Fact label={label}>{isMissing(value) ? <Missing /> : sourceLabel(value)}</Fact>
  );
}

/** Tri-state boolean. "Not on file" is a visible answer, never a silent "no". */
function BoolFact({
  label,
  value,
  goodWhen,
  goodText,
  badText,
}: {
  label: string;
  value: boolean | null;
  goodWhen: boolean;
  goodText: string;
  badText: string;
}) {
  const tone = triTone(value, goodWhen);
  if (tone === "unknown") {
    return (
      <Fact label={label}>
        <Missing />
      </Fact>
    );
  }
  const good = tone === "good";
  return (
    <Fact label={label}>
      <span
        className={`flex items-center gap-1.5 ${good ? "text-ink" : "text-muted"}`}
      >
        <Icon
          icon={good ? "solar:check-circle-linear" : "solar:close-circle-linear"}
          className="text-faint"
        />
        {good ? goodText : badText}
      </span>
    </Fact>
  );
}

/**
 * A lab safety result. Three outcomes, three renderings:
 *   pass    emerald
 *   fail    red
 *   null    hatched "Not tested" — never green, because unknown is not safe.
 */
function SafetyFlag({
  label,
  value,
  goodWhen,
  goodText,
  badText,
}: {
  label: string;
  value: boolean | null;
  goodWhen: boolean;
  goodText: string;
  badText: string;
}) {
  const tone = triTone(value, goodWhen);
  const styles: Record<Tone, { cls: string; icon: string; body: string }> = {
    good: {
      cls: "bg-measured/10 text-measured border-measured/30",
      icon: "solar:check-circle-linear",
      body: goodText,
    },
    bad: {
      cls: "bg-danger/10 text-danger border-danger/40",
      icon: "solar:danger-triangle-bold",
      body: badText,
    },
    unknown: {
      cls: "bg-surface text-faint border-line border-dashed void-hatch",
      icon: "solar:question-circle-linear",
      body: "Not tested",
    },
  };
  const s = styles[tone];
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${s.cls}`}>
      <span className="block text-[10px] uppercase tracking-widest opacity-70">{label}</span>
      <span className="flex items-center gap-1.5 text-xs font-medium mt-1">
        <Icon icon={s.icon} className="shrink-0" />
        {s.body}
      </span>
    </div>
  );
}

/** The testing grade, rendered so the three cannot be mistaken for each other. */
function TestingBadge({ status, size = "sm" }: { status: TestingStatus; size?: "sm" | "lg" }) {
  const meta = statusMeta(status);
  const pad = size === "lg" ? "px-3 py-1.5 text-xs" : "px-2 py-1 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap ${pad} ${meta.badge} ${
        meta.hatched ? "void-hatch" : ""
      }`}
    >
      <Icon icon={meta.icon} className="shrink-0" />
      {meta.label}
    </span>
  );
}

/** An empty section stays on the page and says exactly what is not there. */
function NothingOnFile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface void-hatch px-4 py-3">
      <p className="text-sm font-medium text-muted flex items-center gap-2">
        <Icon icon="solar:file-corrupted-linear" className="text-faint shrink-0" />
        {title}
      </p>
      <p className="text-xs text-faint mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

/**
 * The gap, stated next to the badge that would otherwise hide it.
 *
 * A vendor can hold a spotless independent purity certificate and still have
 * never been checked for endotoxin, heavy metals, or sterility. In the index
 * that vendor carries a green "Independent assay" badge. Without this line, that
 * badge reads as "safe", which is the single most dangerous misreading this page
 * can produce. Compact form rides along with the badge in the list.
 */
function SafetyGapChip({ gap }: { gap: SafetyAxis[] }) {
  if (gap.length === 0) return null;
  return (
    <span className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-signal/90">
      <Icon icon="solar:shield-cross-linear" className="shrink-0 mt-px" />
      <span>Never tested for {axisList(gap)}</span>
    </span>
  );
}

/** Which of the six axes actually have a result. Absence is drawn, not omitted. */
function AxisCoverage({ tested }: { tested: TestedAxes }) {
  const covered = axes(tested);
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
      {AXIS_ORDER.map((axis) => {
        const has = covered[axis];
        const danger = SAFETY_AXES.some((safetyAxis) => safetyAxis === axis);
        const cls = has
          ? "bg-measured/10 text-measured border-measured/30"
          : danger
            ? "bg-signal/10 text-signal/90 border-signal/30 border-dashed void-hatch"
            : "bg-surface text-faint border-line border-dashed void-hatch";
        return (
          <div key={axis} className={`rounded-lg border px-2.5 py-2 ${cls}`}>
            <span className="block text-[10px] uppercase tracking-widest opacity-70">
              {AXIS_LABEL[axis]}
            </span>
            <span className="flex items-center gap-1 text-[11px] font-medium mt-1">
              <Icon
                icon={has ? "solar:check-circle-linear" : "solar:question-circle-linear"}
                className="shrink-0"
              />
              {has ? "Result on file" : "Never tested"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The finding that a purity certificate is designed to distract from. Shown
 * whenever a vendor HAS independent testing but that testing skipped an axis
 * that hurts people — precisely the case where the page otherwise looks green.
 */
function SafetyGapNotice({ gap }: { gap: SafetyAxis[] }) {
  if (gap.length === 0) return null;
  return (
    <div className="rounded-xl border border-signal/40 bg-signal/10 px-5 py-4">
      <p className="font-display tracking-tight text-base font-semibold text-signal flex items-center gap-2">
        <Icon icon="solar:shield-cross-bold" className="text-xl shrink-0" />
        Tested, but not for {axisList(gap)}
      </p>
      <p className="text-sm text-signal/90 mt-1.5 leading-relaxed">
        There is an independent assay on file for this vendor, and it did not cover{" "}
        {axisList(gap)}. Purity is the axis that barely varies across this market, and it is almost
        the only one anybody measures. The axes left blank here are the ones that send people to
        hospital. An assay that skipped them is not a clean bill of health, and the pass above is not
        evidence of anything it did not test.
      </p>
    </div>
  );
}

function SectionCaption({ tone, children }: { tone: "evidence" | "claim" | "anecdote"; children: ReactNode }) {
  const map = {
    evidence: "text-measured/90 border-measured/30",
    claim: "text-signal/90 border-signal/30",
    anecdote: "text-muted border-line",
  } as const;
  return (
    <p className={`text-xs leading-relaxed border-l-2 pl-3 mb-4 ${map[tone]}`}>{children}</p>
  );
}

// ------------------------------------------------------------------ list view

function CountStrip({ vendor }: { vendor: VendorSummary }) {
  const assays = count(vendor.independent_assays);
  const claims = count(vendor.vendor_claims);
  const reports = count(vendor.member_reports);
  return (
    <div className="flex items-center gap-3 readout text-[11px] whitespace-nowrap">
      <span className={assays > 0 ? "text-measured" : "text-faint"}>
        {assays} assay{assays === 1 ? "" : "s"}
      </span>
      <span className="text-ghost">/</span>
      <span className={claims > 0 ? "text-signal" : "text-faint"}>
        {claims} claim{claims === 1 ? "" : "s"}
      </span>
      <span className="text-ghost">/</span>
      <span className="text-faint">
        {reports} report{reports === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function VendorRow({ vendor, onOpen }: { vendor: VendorSummary; onOpen: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(vendor.id)}
      className="w-full text-left px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface-2/40 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal/50"
    >
      <div className="grid grid-cols-12 gap-3 items-center">
        <div className="col-span-12 md:col-span-3 min-w-0">
          <p className="font-display tracking-tight text-sm font-medium text-ink truncate group-hover:text-signal transition-colors">
            {isMissing(vendor.name) ? "Unnamed vendor" : text(vendor.name)}
          </p>
          <p className="text-xs text-faint truncate">
            {isMissing(vendor.manufacturer) ? "Manufacturer not on file" : text(vendor.manufacturer)}
          </p>
        </div>

        <div className="col-span-6 md:col-span-2 min-w-0">
          <p className="text-xs text-muted truncate">
            {isMissing(vendor.country) ? <Missing>Country not on file</Missing> : text(vendor.country)}
          </p>
        </div>

        <div className="col-span-6 md:col-span-2 min-w-0">
          {isMissing(vendor.source_type) ? (
            <p className="text-xs truncate">
              <Missing>Source type not on file</Missing>
            </p>
          ) : (
            <p className="text-xs text-muted truncate">{sourceLabel(vendor.source_type)}</p>
          )}
        </div>

        <div className="col-span-12 md:col-span-3">
          <TestingBadge status={vendor.testing_status} />
          {/* The badge is never allowed to travel alone. If a lab measured this
              vendor but skipped the axes that hurt people, that rides with it. */}
          {count(vendor.independent_assays) > 0 && (
            <SafetyGapChip gap={safetyGap(vendor.tested_axes)} />
          )}
        </div>

        <div className="col-span-12 md:col-span-2 md:justify-self-end">
          <CountStrip vendor={vendor} />
        </div>
      </div>
    </button>
  );
}

// -------------------------------------------------------------- drill-in view

function AssayCard({ assay }: { assay: IndependentAssay }) {
  const failed = assay.failed;
  const potency = num(assay.potency_factor);
  const outcome: Tone = triTone(failed, false);
  // What this particular assay never looked at. A pass is only a pass on the
  // axes that were actually run, and the banner is worded accordingly.
  const gap = safetyGap(assayAxes(assay));
  const sourceUrl = link(assay.source_url);

  const banner: Record<Tone, { cls: string; icon: string; body: string }> = {
    good: {
      cls: "bg-measured/10 border-measured/30 text-measured",
      icon: "solar:verified-check-bold",
      body: gap.length > 0 ? "Passed the checks that were run" : "Passed the independent assay",
    },
    bad: {
      cls: "bg-danger/15 border-danger/50 text-danger",
      icon: "solar:danger-triangle-bold",
      body: "FAILED the independent assay",
    },
    unknown: {
      cls: "bg-surface border-line border-dashed text-faint void-hatch",
      icon: "solar:question-circle-linear",
      body: "Pass or fail was not recorded",
    },
  };
  const b = banner[outcome];

  return (
    <div
      className={`rounded-[var(--radius-card)] border overflow-hidden ${
        outcome === "bad" ? "border-danger/40 bg-danger/5" : "border-line bg-base/40"
      }`}
    >
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${b.cls}`}>
        <Icon icon={b.icon} className="shrink-0" />
        <span className={`text-sm ${outcome === "bad" ? "font-bold tracking-wide" : "font-medium"}`}>
          {b.body}
        </span>
        <span className="ml-auto readout text-[11px] text-muted shrink-0">
          {compoundLabel(assay.compound_id)}
        </span>
      </div>

      {outcome === "bad" && (
        <div className="px-4 py-3 border-b border-danger/30 bg-danger/10">
          <p className="text-[10px] uppercase tracking-widest text-danger/80">Reason for failure</p>
          <p className="text-sm text-danger/90 mt-1 leading-relaxed">
            {isMissing(assay.fail_reason)
              ? "The lab recorded a failure but gave no reason."
              : text(assay.fail_reason)}
          </p>
        </div>
      )}

      {outcome === "good" && gap.length > 0 && (
        <div className="px-4 py-2.5 border-b border-signal/25 bg-signal/5">
          <p className="text-xs text-signal/90 leading-relaxed flex items-start gap-1.5">
            <Icon icon="solar:shield-cross-linear" className="shrink-0 mt-0.5" />
            <span>
              This lab never tested for {axisList(gap)}. The pass above covers only the axes it
              measured, and says nothing about the ones it did not.
            </span>
          </p>
        </div>
      )}

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-3 gap-4">
        <Fact label="Purity">
          {num(assay.purity_pct) === null ? <Missing /> : <span className="readout">{pct(assay.purity_pct)}</span>}
        </Fact>
        <Fact label="Label vs tested">
          {num(assay.label_mg) === null && num(assay.tested_mg) === null ? (
            <Missing />
          ) : (
            <span className="readout">
              {mg(assay.tested_mg)} <span className="text-faint">of</span> {mg(assay.label_mg)}
            </span>
          )}
        </Fact>
        <Fact label="Potency factor">
          {potency === null ? (
            <Missing />
          ) : (
            <span
              className={`readout ${potency < 0.95 ? "text-signal" : "text-measured"}`}
            >
              {potency}x
              {potency < 0.95 && (
                <span className="text-faint ml-1 font-sans text-xs">under label</span>
              )}
            </span>
          )}
        </Fact>
      </div>

      <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        <SafetyFlag
          label="Identity"
          value={assay.identity_verified}
          goodWhen
          goodText="Verified"
          badText="Not the labelled compound"
        />
        <SafetyFlag
          label="Endotoxin"
          value={assay.endotoxin_detected}
          goodWhen={false}
          goodText="None detected"
          badText="Detected"
        />
        <SafetyFlag
          label="Heavy metals"
          value={assay.heavy_metals_detected}
          goodWhen={false}
          goodText="None detected"
          badText="Detected"
        />
        <SafetyFlag
          label="Sterility"
          value={assay.sterility_pass}
          goodWhen
          goodText="Passed"
          badText="Failed"
        />
      </div>

      <div className="px-4 py-2.5 border-t border-line bg-surface-2/40 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="text-muted">
          Lab:{" "}
          {isMissing(assay.test_lab) ? (
            <Missing>Lab not named</Missing>
          ) : (
            <span className="text-ink">{text(assay.test_lab)}</span>
          )}
        </span>
        <span className="text-muted">
          Method:{" "}
          {isMissing(assay.test_method) ? (
            <Missing>Not stated</Missing>
          ) : (
            <span className="text-ink">{text(assay.test_method)}</span>
          )}
        </span>
        <span className="text-muted">
          Tested:{" "}
          {isMissing(assay.test_date) ? (
            <Missing>Date not stated</Missing>
          ) : (
            <span className="text-ink readout">{whenText(assay.test_date)}</span>
          )}
        </span>
        {sourceUrl === null ? (
          <span className="text-faint ml-auto">No source link on file</span>
        ) : (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-signal hover:text-signal-bright flex items-center gap-1"
          >
            Source
            <Icon icon="solar:arrow-right-up-linear" />
          </a>
        )}
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: VendorClaim }) {
  const tested = claim.third_party_tested;
  const labs = (claim.test_labs ?? []).filter((lab) => !isMissing(lab));
  const coaUrl = link(claim.coa_url);
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-signal/30 bg-signal/5 px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-signal flex items-center gap-2">
          <Icon icon="solar:chat-round-unread-linear" className="shrink-0" />
          {tested === true
            ? "The vendor claims its product is third-party tested"
            : tested === false
              ? "The vendor states its product is not third-party tested"
              : "The vendor did not say whether its product is tested"}
        </p>
        <span className="eyebrow !text-[10px] shrink-0">
          Submitted {whenText(claim.submitted_at)}
        </span>
      </div>

      {tested === true && (
        <p className="text-xs text-muted leading-relaxed">
          No assay backing this claim is on file. Until a lab result appears in section 2, this is
          the vendor talking about itself.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Fact label="Labs the vendor names">
          {labs.length === 0 ? <Missing>None named</Missing> : labs.join(", ")}
        </Fact>
        <BoolFact
          label="GMP (claimed)"
          value={claim.gmp_certified}
          goodWhen
          goodText="Vendor claims GMP"
          badText="Vendor claims no GMP"
        />
        <Fact label="Certificate of analysis">
          {coaUrl === null ? (
            <Missing>No COA supplied</Missing>
          ) : (
            <a
              href={coaUrl}
              target="_blank"
              rel="noreferrer"
              className="text-signal hover:text-signal-bright inline-flex items-center gap-1"
            >
              Vendor-supplied COA
              <Icon icon="solar:arrow-right-up-linear" />
            </a>
          )}
        </Fact>
      </div>

      {coaUrl !== null && (
        <p className="text-[11px] text-signal/70">
          That COA was supplied by the vendor. PepHouse has not verified it and did not commission it.
          A vendor-supplied purity certificate is not an assay, and it almost never covers endotoxin,
          heavy metals, or sterility.
        </p>
      )}

      {!isMissing(claim.notes) && (
        <p className="text-xs text-muted leading-relaxed border-l-2 border-line pl-3">
          {text(claim.notes)}
        </p>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: MemberReport }) {
  const sentiment = (report.sentiment ?? "").toLowerCase();
  // Member sentiment is anecdote, the weakest grade on the page, so it is never
  // hue-coded good/bad. A negative or mixed read is flagged in the warm signal
  // voice; a positive or neutral read stays quiet.
  const sentimentCls =
    sentiment === "positive"
      ? "text-muted"
      : sentiment === "negative"
        ? "text-signal"
        : sentiment === "mixed"
          ? "text-signal/80"
          : "text-faint";

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-base/40 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="readout text-[11px] text-faint">
          {compoundLabel(report.compound_id)}
        </span>
        <span className={`text-[11px] uppercase tracking-wider ${sentimentCls}`}>
          {isMissing(report.sentiment) ? "No sentiment given" : text(report.sentiment)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Fact label="Purity the member reports">
          {num(report.tested_purity_pct) === null ? (
            <Missing>Not reported</Missing>
          ) : (
            <span className="readout text-muted">{pct(report.tested_purity_pct)}</span>
          )}
        </Fact>
        <BoolFact
          label="Member says batch was lab-tested"
          value={report.batch_lab_tested}
          goodWhen
          goodText="Member says yes"
          badText="Member says no"
        />
        <Fact label="Cost paid">
          {num(report.cost_usd) === null ? (
            <Missing>Not reported</Missing>
          ) : (
            <span className="readout text-muted">{usd(report.cost_usd)}</span>
          )}
        </Fact>
      </div>

      {!isMissing(report.notes) && (
        <p className="text-xs text-muted leading-relaxed border-l-2 border-line pl-3">
          {text(report.notes)}
        </p>
      )}
    </div>
  );
}

function SourcingCard({ row }: { row: SourcingRow }) {
  const shipsFrom = (row.ships_from ?? []).filter((place) => !isMissing(place));
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-base/40 px-4 py-3 space-y-3">
      <span className="readout text-[11px] text-faint">{compoundLabel(row.compound_id)}</span>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SourceFact label="Source type" value={row.source_type} />
        <TextFact label="Origin country" value={row.origin_country} />
        <Fact label="Ships from">
          {shipsFrom.length === 0 ? <Missing>Not stated</Missing> : shipsFrom.join(", ")}
        </Fact>
        <TextFact label="Payment" value={row.payment} />
      </div>
      {!isMissing(row.notes) && (
        <p className="text-xs text-muted leading-relaxed border-l-2 border-line pl-3">
          {text(row.notes)}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- contact channels

/**
 * A t.me link when the Telegram value looks like a handle or a URL, otherwise
 * null so the raw value renders as plain text rather than as a broken link. A
 * grey-market source often lists only a Telegram or WhatsApp channel, so the
 * absence of a website is treated as a neutral fact, never as a red flag.
 */
function telegramHref(value: string): string | null {
  const raw = value.trim();
  if (raw.length === 0) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const withoutTme = raw.replace(/^t\.me\//i, "");
  const handle = withoutTme.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{3,32}$/.test(handle)) return `https://t.me/${handle}`;
  return null;
}

/** One contact channel, shown only when present. Absent single channels read as
 *  a plain "None listed", never as a warning. */
function ChannelFact({ label, children }: { label: string; children: ReactNode }) {
  return <Fact label={label}>{children}</Fact>;
}

/**
 * Website, Telegram, WhatsApp, and any other channel, grouped together.
 *
 * The framing here is deliberate: a missing website is common for grey-market
 * sources that operate on a private channel only, so it is never styled as a
 * problem. When every channel is empty, that is stated once as a neutral fact.
 */
function ContactChannels({ vendor }: { vendor: VendorBreakdown }) {
  const website = link(vendor.website);
  const telegram = (vendor.telegram ?? "").trim();
  const whatsapp = (vendor.whatsapp ?? "").trim();
  const other = (vendor.contact_other ?? "").trim();
  const telegramUrl = telegramHref(telegram);
  const none =
    website === null && telegram.length === 0 && whatsapp.length === 0 && other.length === 0;

  return (
    <div className="mt-5 pt-5 border-t border-line">
      <p className="eyebrow !text-[10px] mb-3">Contact channels</p>
      {none ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-base/40 px-4 py-3">
          <p className="text-sm text-muted flex items-center gap-2">
            <Icon icon="solar:link-broken-linear" className="text-faint shrink-0" />
            No contact channel on file
          </p>
          <p className="text-xs text-faint mt-1 leading-relaxed">
            No website, Telegram, WhatsApp, or other channel is recorded. This is a neutral fact and
            not a red flag: many sources share contact details only in private.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <ChannelFact label="Website">
              {website === null ? (
                <span className="text-sm text-faint">None listed</span>
              ) : (
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal hover:text-signal-bright inline-flex items-center gap-1 break-all"
                >
                  {website}
                  <Icon icon="solar:arrow-right-up-linear" className="shrink-0" />
                </a>
              )}
            </ChannelFact>
            <ChannelFact label="Telegram">
              {telegram.length === 0 ? (
                <span className="text-sm text-faint">None listed</span>
              ) : telegramUrl !== null ? (
                <a
                  href={telegramUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-signal hover:text-signal-bright inline-flex items-center gap-1 break-all"
                >
                  {telegram}
                  <Icon icon="solar:arrow-right-up-linear" className="shrink-0" />
                </a>
              ) : (
                <span className="text-sm text-ink break-words">{telegram}</span>
              )}
            </ChannelFact>
            <ChannelFact label="WhatsApp">
              {whatsapp.length === 0 ? (
                <span className="text-sm text-faint">None listed</span>
              ) : (
                <span className="text-sm text-ink break-words">{whatsapp}</span>
              )}
            </ChannelFact>
            <ChannelFact label="Other contact">
              {other.length === 0 ? (
                <span className="text-sm text-faint">None listed</span>
              ) : (
                <span className="text-sm text-ink break-words">{other}</span>
              )}
            </ChannelFact>
          </div>
          {website === null && (
            <p className="mt-3 text-xs text-faint leading-relaxed flex items-start gap-1.5">
              <Icon icon="solar:info-circle-linear" className="shrink-0 mt-0.5" />
              <span>
                No website is listed. For a grey-market source that is common and not a red flag on
                its own: many operate on a private channel only.
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- contribute forms
//
// Two write paths on the vendor page: a buyer report (member) and a vendor
// statement (vendor claim). Neither is evidence, and the UI says so at the point
// of entry. Every field follows the same rules as the standalone submit form: an
// unanswered tri-state reaches the API as an absent key, never a silent false,
// and nothing published here outranks an independent assay. Both paths are
// review-gated: a submission lands in the operator queue and appears on this page
// only after a human approves it, labelled unverified.

const FORM_INPUT =
  "w-full bg-base border border-line rounded-lg py-2.5 px-3 text-sm text-ink " +
  "placeholder:text-faint outline-none focus:border-line-bright focus-visible:ring-1 focus-visible:ring-signal transition-colors";

type TriState = "yes" | "no" | "unknown";
type Sentiment = "positive" | "neutral" | "negative";

const TRI_OPTIONS: { value: TriState; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

const SENTIMENT_OPTIONS: { value: Sentiment; label: string }[] = [
  { value: "positive", label: "Positive" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Negative" },
];

/** Unknown must reach the API as an absent key, never as a silent false. */
function triToBool(value: TriState): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

/** Blank strings are not data. Send nothing rather than an empty string. */
function textOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function labsOrUndefined(raw: string): string[] | undefined {
  const labs = raw
    .split(",")
    .map((lab) => lab.trim())
    .filter((lab) => lab.length > 0);
  return labs.length > 0 ? labs : undefined;
}

/** A finite, non-negative number, or nothing. An unparseable cost is never sent
 *  as 0 or NaN. */
function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** apiJson throws with the raw response body, and FastAPI sends {"detail": "..."}.
 *  Show the detail, not the JSON envelope. */
function describeError(caught: unknown): string {
  const fallback = "The submission did not go through. Check the connection and try again.";
  if (!(caught instanceof Error)) return fallback;
  const raw = caught.message.trim();
  if (raw.length === 0) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "detail" in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      if (typeof detail === "string" && detail.trim().length > 0) return detail.trim();
    }
  } catch {
    // Not JSON. The body text is the message.
  }
  return raw;
}

/**
 * A 403 comes back when the account is anonymous server-side. apiJson discards
 * the status code, so this matches the words the backend detail and the http
 * layer produce rather than a numeric status.
 */
function looksLikeAuthError(caught: unknown): boolean {
  if (!(caught instanceof Error)) return false;
  const raw = caught.message.toLowerCase();
  return (
    raw.includes("403") ||
    raw.includes("forbidden") ||
    raw.includes("sign in") ||
    raw.includes("signed in") ||
    raw.includes("anonymous") ||
    raw.includes("durable") ||
    raw.includes("google account")
  );
}

/** The trimmed vendor name, or a stable placeholder. vendor_id carries identity;
 *  vendor_name is context and must never be sent as the words "Not on file". */
function vendorNameFor(vendor: VendorBreakdown): string {
  const trimmed = (vendor.name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Unnamed vendor";
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {hint !== undefined && (
        <p className="text-[11px] text-faint mt-0.5 leading-relaxed">{hint}</p>
      )}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * Three equal buttons. The selected state looks the same whichever answer it is:
 * the form must not reward a vendor for tapping "Yes".
 */
function TriStateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: TriState;
  onChange: (next: TriState) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="text-[11px] text-faint mt-0.5 leading-relaxed">{hint}</p>
      <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label={label}>
        {TRI_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
                active
                  ? "border-signal/50 bg-signal/10 text-signal"
                  : "border-line bg-base/60 text-muted hover:border-line-bright"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Sentiment as a segmented control. Nothing is selected by default, so a member
 *  who skips it sends no sentiment rather than a silent "neutral". */
function SentimentField({
  value,
  onChange,
}: {
  value: Sentiment | null;
  onChange: (next: Sentiment) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">Your read on this vendor</p>
      <p className="text-[11px] text-faint mt-0.5 leading-relaxed">
        Your own experience, not a measurement. Nothing is selected by default.
      </p>
      <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Sentiment">
        {SENTIMENT_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
                active
                  ? "border-signal/50 bg-signal/10 text-signal"
                  : "border-line bg-base/60 text-muted hover:border-line-bright"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The review-gate disclosure, stated above every submit button. */
function ReviewGateNotice() {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 flex gap-2.5">
      <Icon icon="solar:shield-check-linear" className="text-signal text-base shrink-0 mt-0.5" />
      <p className="text-[11px] text-muted leading-relaxed">
        Your report is reviewed before it appears. Nothing here goes public immediately: it goes to
        the operator queue and shows on this page only after a human approves it. When it appears it
        is labelled unverified, and it never outranks an independent assay.
      </p>
    </div>
  );
}

function FormNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-signal/20 bg-signal/5 px-3 py-2.5 flex gap-2.5">
      <Icon icon="solar:danger-triangle-linear" className="text-signal text-base shrink-0 mt-0.5" />
      <p className="text-[11px] text-signal/90 leading-relaxed">{children}</p>
    </div>
  );
}

function FormError({ message, onSignIn }: { message: string; onSignIn: (() => void) | null }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5">
      <div className="flex gap-2.5">
        <Icon icon="solar:close-circle-linear" className="text-danger text-base shrink-0 mt-0.5" />
        <p className="text-sm text-danger leading-relaxed">{message}</p>
      </div>
      {onSignIn !== null && (
        <button
          type="button"
          onClick={onSignIn}
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-sm font-medium text-signal hover:bg-signal/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
        >
          <Icon icon="solar:login-3-linear" />
          Sign in with Google
        </button>
      )}
    </div>
  );
}

function SubmittedCard({ title, onAnother }: { title: string; onAnother: () => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface-2 p-4" role="status">
      <p className="text-sm font-medium text-ink flex items-center gap-2">
        <Icon icon="solar:check-read-linear" className="text-signal shrink-0" />
        {title}
      </p>
      <p className="text-xs text-muted mt-1.5 leading-relaxed">
        It is in the operator queue, pending review. It is not on this page yet and will not appear
        until a human approves it. When it does, it is labelled unverified.
      </p>
      <button
        type="button"
        onClick={onAnother}
        className="mt-3 text-xs font-medium text-signal hover:text-signal-bright transition-colors flex items-center gap-1.5"
      >
        <Icon icon="solar:add-circle-linear" />
        Add another
      </button>
    </div>
  );
}

interface MemberDraft {
  compound: string;
  sentiment: Sentiment | null;
  costUsd: string;
  batchLabTested: TriState;
  notes: string;
}

const EMPTY_MEMBER: MemberDraft = {
  compound: "",
  sentiment: null,
  costUsd: "",
  batchLabTested: "unknown",
  notes: "",
};

/** "Add your experience": a buyer report, the lowest grade of information here. */
function MemberReportForm({ vendor, onSignIn }: { vendor: VendorBreakdown; onSignIn: () => void }) {
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function set<K extends keyof MemberDraft>(key: K, value: MemberDraft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setAuthError(false);
    setSubmitting(true);

    // Free-text compound is preserved in the note rather than guessed into a
    // numeric id that might point at the wrong compound, so report_compound_id
    // is left unset.
    const compound = textOrUndefined(draft.compound);
    const notes = textOrUndefined(draft.notes);
    const combinedNotes =
      compound !== undefined
        ? notes !== undefined
          ? `Compound: ${compound}\n\n${notes}`
          : `Compound: ${compound}`
        : notes;

    const payload: VendorSubmissionInput = {
      vendor_name: vendorNameFor(vendor),
      vendor_id: vendor.id,
      submission_kind: "member",
      submitted_by: "member",
      report_sentiment: draft.sentiment ?? undefined,
      report_cost_usd: numberOrUndefined(draft.costUsd),
      report_batch_lab_tested: triToBool(draft.batchLabTested),
      notes: combinedNotes,
    };

    try {
      await submitVendor(payload);
      setSubmitted(true);
      setDraft(EMPTY_MEMBER);
    } catch (caught) {
      const auth = looksLikeAuthError(caught);
      setAuthError(auth);
      setError(
        auth
          ? "This needs a signed-in Google account. Sign in and try again."
          : describeError(caught),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <SubmittedCard title="Your experience was submitted" onAnother={() => setSubmitted(false)} />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <p className="text-xs text-faint leading-relaxed">
        A buyer report is the lowest grade of information on this page. It is unverified and it is
        not a lab test. Every field is optional.
      </p>
      <Field
        id="member-compound"
        label="Which compound"
        hint="Free text is fine. Recorded alongside your note."
      >
        <input
          id="member-compound"
          type="text"
          value={draft.compound}
          onChange={(e) => set("compound", e.target.value)}
          placeholder="e.g. Retatrutide"
          autoComplete="off"
          className={FORM_INPUT}
        />
      </Field>
      <SentimentField value={draft.sentiment} onChange={(next) => set("sentiment", next)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="member-cost" label="Cost paid (USD)" hint="Optional.">
          <input
            id="member-cost"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={draft.costUsd}
            onChange={(e) => set("costUsd", e.target.value)}
            placeholder="Optional"
            autoComplete="off"
            className={FORM_INPUT}
          />
        </Field>
        <TriStateField
          label="Was the batch lab-tested"
          hint="What you were told or saw. Unknown stays Unknown."
          value={draft.batchLabTested}
          onChange={(next) => set("batchLabTested", next)}
        />
      </div>
      <Field
        id="member-notes"
        label="Notes"
        hint="What a buyer would want to know. It publishes as written."
      >
        <textarea
          id="member-notes"
          rows={3}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Optional"
          className={`${FORM_INPUT} resize-none`}
        />
      </Field>

      {error !== null && <FormError message={error} onSignIn={authError ? onSignIn : null} />}
      <ReviewGateNotice />
      <button
        type="submit"
        disabled={submitting}
        className="w-full min-h-12 rounded-lg bg-signal text-base font-semibold py-3 text-sm hover:bg-signal-bright transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
      >
        {submitting ? (
          <>
            <Icon icon="svg-spinners:180-ring" />
            Submitting
          </>
        ) : (
          <>
            <Icon icon="solar:upload-linear" />
            Submit your experience for review
          </>
        )}
      </button>
    </form>
  );
}

interface StatementDraft {
  thirdPartyTested: TriState;
  testLabs: string;
  coaUrl: string;
  gmpCertified: TriState;
  telegram: string;
  whatsapp: string;
  contactOther: string;
  notes: string;
}

const EMPTY_STATEMENT: StatementDraft = {
  thirdPartyTested: "unknown",
  testLabs: "",
  coaUrl: "",
  gmpCertified: "unknown",
  telegram: "",
  whatsapp: "",
  contactOther: "",
  notes: "",
};

/** "Add a vendor statement": a vendor claim. Not an assay, and never rendered as
 *  one. */
function VendorStatementForm({
  vendor,
  onSignIn,
}: {
  vendor: VendorBreakdown;
  onSignIn: () => void;
}) {
  const [draft, setDraft] = useState<StatementDraft>(EMPTY_STATEMENT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function set<K extends keyof StatementDraft>(key: K, value: StatementDraft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setAuthError(false);
    setSubmitting(true);

    const payload: VendorSubmissionInput = {
      vendor_name: vendorNameFor(vendor),
      vendor_id: vendor.id,
      submission_kind: "vendor",
      submitted_by: "vendor",
      third_party_tested: triToBool(draft.thirdPartyTested),
      test_labs: labsOrUndefined(draft.testLabs),
      coa_url: textOrUndefined(draft.coaUrl),
      gmp_certified: triToBool(draft.gmpCertified),
      telegram: textOrUndefined(draft.telegram),
      whatsapp: textOrUndefined(draft.whatsapp),
      contact_other: textOrUndefined(draft.contactOther),
      notes: textOrUndefined(draft.notes),
    };

    try {
      await submitVendor(payload);
      setSubmitted(true);
      setDraft(EMPTY_STATEMENT);
    } catch (caught) {
      const auth = looksLikeAuthError(caught);
      setAuthError(auth);
      setError(
        auth
          ? "This needs a signed-in Google account. Sign in and try again."
          : describeError(caught),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <SubmittedCard title="Your statement was submitted" onAnother={() => setSubmitted(false)} />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <p className="text-xs text-faint leading-relaxed">
        Everything here is a claim, not evidence. Only an independent lab assay counts as evidence,
        and this form cannot produce one. Every field is optional.
      </p>
      <TriStateField
        label="Third-party tested"
        hint="What the vendor states about itself. Leave it on Unknown if nobody knows."
        value={draft.thirdPartyTested}
        onChange={(next) => set("thirdPartyTested", next)}
      />
      {draft.thirdPartyTested === "yes" && (
        <FormNote>
          Recorded as a vendor claim. A claim is not an assay and it never renders as one. It stays a
          claim until an independent lab result of our own is on file.
        </FormNote>
      )}
      <Field
        id="statement-labs"
        label="Testing labs"
        hint="Comma separated. Naming the lab is what makes the claim checkable."
      >
        <input
          id="statement-labs"
          type="text"
          value={draft.testLabs}
          onChange={(e) => set("testLabs", e.target.value)}
          placeholder="Janoshik, Colmaric"
          autoComplete="off"
          className={FORM_INPUT}
        />
      </Field>
      <Field id="statement-coa" label="Certificate of analysis (link)">
        <input
          id="statement-coa"
          type="url"
          inputMode="url"
          value={draft.coaUrl}
          onChange={(e) => set("coaUrl", e.target.value)}
          placeholder="https://"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={FORM_INPUT}
        />
      </Field>
      <TriStateField
        label="GMP certified"
        hint="Same rule as above. Unknown stays Unknown."
        value={draft.gmpCertified}
        onChange={(next) => set("gmpCertified", next)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="statement-telegram" label="Telegram" hint="Handle or link.">
          <input
            id="statement-telegram"
            type="text"
            value={draft.telegram}
            onChange={(e) => set("telegram", e.target.value)}
            placeholder="@handle"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={FORM_INPUT}
          />
        </Field>
        <Field id="statement-whatsapp" label="WhatsApp" hint="Number or link.">
          <input
            id="statement-whatsapp"
            type="text"
            value={draft.whatsapp}
            onChange={(e) => set("whatsapp", e.target.value)}
            placeholder="Optional"
            autoComplete="off"
            className={FORM_INPUT}
          />
        </Field>
      </div>
      <Field
        id="statement-other"
        label="Other contact"
        hint="Any other channel a buyer would use."
      >
        <input
          id="statement-other"
          type="text"
          value={draft.contactOther}
          onChange={(e) => set("contactOther", e.target.value)}
          placeholder="Optional"
          autoComplete="off"
          className={FORM_INPUT}
        />
      </Field>
      <Field id="statement-notes" label="Notes" hint="It publishes as written.">
        <textarea
          id="statement-notes"
          rows={3}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Optional"
          className={`${FORM_INPUT} resize-none`}
        />
      </Field>

      {error !== null && <FormError message={error} onSignIn={authError ? onSignIn : null} />}
      <ReviewGateNotice />
      <button
        type="submit"
        disabled={submitting}
        className="w-full min-h-12 rounded-lg bg-signal text-base font-semibold py-3 text-sm hover:bg-signal-bright transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
      >
        {submitting ? (
          <>
            <Icon icon="svg-spinners:180-ring" />
            Submitting
          </>
        ) : (
          <>
            <Icon icon="solar:upload-linear" />
            Submit statement for review
          </>
        )}
      </button>
    </form>
  );
}

/**
 * The two write paths, gated behind a durable account. An anonymous session gets
 * a sign-in call to action instead of a form, because the backend refuses an
 * anonymous submission with a 403.
 */
function ContributeSection({ vendor }: { vendor: VendorBreakdown }) {
  const { isAnonymous, signInWithGoogle } = useAuth();
  const [open, setOpen] = useState<"member" | "vendor" | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const handleSignIn = useCallback((): void => {
    setSignInError(null);
    signInWithGoogle().catch(() => {
      setSignInError("Could not start Google sign-in. Try again.");
    });
  }, [signInWithGoogle]);

  return (
    <Panel className="p-5">
      <PanelHeader icon="solar:pen-new-square-linear" title="Add to this record" />
      <SectionCaption tone="anecdote">
        Add your own buyer experience, or add a statement as this vendor. Both are reviewed before
        they appear on this page and both publish labelled unverified. A member report is the lowest
        grade of information here, and a vendor statement is a claim, never an independent assay.
      </SectionCaption>

      {isAnonymous ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-base/60 px-4 py-4">
          <p className="text-sm text-muted leading-relaxed">
            Contributing needs a signed-in Google account so a submission can be attributed and
            reviewed. An anonymous session cannot post to the queue.
          </p>
          <button
            type="button"
            onClick={handleSignIn}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3.5 py-2.5 text-sm font-medium text-signal hover:bg-signal/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
          >
            <Icon icon="solar:login-3-linear" />
            Sign in with Google to contribute
          </button>
          {signInError !== null && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {signInError}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOpen(open === "member" ? null : "member")}
              aria-expanded={open === "member"}
              className={`rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
                open === "member"
                  ? "border-signal/50 bg-signal/10"
                  : "border-line bg-base/60 hover:border-line-bright"
              }`}
            >
              <span
                className={`block text-sm font-medium ${
                  open === "member" ? "text-signal" : "text-ink"
                }`}
              >
                Add your experience
              </span>
              <span className="block text-xs text-faint mt-0.5">A buyer report. Unverified.</span>
            </button>
            <button
              type="button"
              onClick={() => setOpen(open === "vendor" ? null : "vendor")}
              aria-expanded={open === "vendor"}
              className={`rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
                open === "vendor"
                  ? "border-signal/50 bg-signal/10"
                  : "border-line bg-base/60 hover:border-line-bright"
              }`}
            >
              <span
                className={`block text-sm font-medium ${
                  open === "vendor" ? "text-signal" : "text-ink"
                }`}
              >
                Add a vendor statement
              </span>
              <span className="block text-xs text-faint mt-0.5">A vendor claim. Not an assay.</span>
            </button>
          </div>

          {open === "member" && (
            <div className="mt-4">
              <MemberReportForm vendor={vendor} onSignIn={handleSignIn} />
            </div>
          )}
          {open === "vendor" && (
            <div className="mt-4">
              <VendorStatementForm vendor={vendor} onSignIn={handleSignIn} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function VendorDetail({ vendor, onBack }: { vendor: VendorBreakdown; onBack: () => void }) {
  const assays = vendor.independent_assays ?? [];
  const claims = vendor.vendor_claims ?? [];
  const reports = vendor.member_reports ?? [];
  const sourcing = vendor.sourcing ?? [];
  const failedAssays = assays.filter((a) => a.failed === true);
  const meta = statusMeta(vendor.testing_status);
  const tested = axes(vendor.tested_axes);
  const gap = safetyGap(vendor.tested_axes);

  return (
    <div className="max-w-5xl space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-xs font-medium text-muted hover:text-ink transition-colors flex items-center gap-1.5"
      >
        <Icon icon="solar:arrow-left-linear" />
        All vendors
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display tracking-tight text-2xl font-semibold text-ink">
          {isMissing(vendor.name) ? "Unnamed vendor" : text(vendor.name)}
        </h2>
        <TestingBadge status={vendor.testing_status} size="lg" />
      </div>
      <p className="text-sm text-muted -mt-2 max-w-3xl leading-relaxed">{meta.blurb}</p>

      {failedAssays.length > 0 && (
        <div className="rounded-xl border border-danger/50 bg-danger/15 px-5 py-4">
          <p className="font-display tracking-tight text-base font-bold text-danger flex items-center gap-2">
            <Icon icon="solar:danger-triangle-bold" className="text-xl shrink-0" />
            This vendor failed an independent assay
          </p>
          <p className="text-sm text-danger/90 mt-1.5 leading-relaxed">
            {failedAssays.length} of {assays.length} assay
            {assays.length === 1 ? "" : "s"} on file came back as a failure. Read section 2 before
            you read anything else on this page.
          </p>
        </div>
      )}

      {/* The green badge, corrected. Only fires when a lab actually measured this
          vendor and still left an axis that hurts people unmeasured. */}
      {assays.length > 0 && <SafetyGapNotice gap={gap} />}

      {/* 1. Identity */}
      <Panel className="p-5">
        <PanelHeader icon="solar:buildings-2-linear" title="1. Identity" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <TextFact label="Manufacturer" value={vendor.manufacturer} />
          <TextFact label="Country" value={vendor.country} />
          <SourceFact label="Source type" value={vendor.source_type} />
          <BoolFact
            label="GMP certified"
            value={vendor.gmp_certified}
            goodWhen
            goodText="Certified"
            badText="Not certified"
          />
          <BoolFact
            label="FDA green list"
            value={vendor.fda_green_list}
            goodWhen
            goodText="Listed"
            badText="Not listed"
          />
          <TextFact label="FDA DMF" value={vendor.fda_dmf} />
          <Fact label="Cost">
            {isMissing(vendor.cost_tier) &&
            num(vendor.cost_per_vial_usd) === null &&
            num(vendor.cost_multiple_vs_gray) === null ? (
              <Missing />
            ) : (
              <span className="text-ink">
                {isMissing(vendor.cost_tier) ? "" : `${text(vendor.cost_tier)} `}
                {num(vendor.cost_per_vial_usd) !== null && (
                  <span className="readout text-muted">
                    {usd(vendor.cost_per_vial_usd)} per vial
                  </span>
                )}
                {num(vendor.cost_multiple_vs_gray) !== null && (
                  <span className="readout text-faint block text-xs">
                    {num(vendor.cost_multiple_vs_gray)}x gray-market price
                  </span>
                )}
              </span>
            )}
          </Fact>
        </div>
        <ContactChannels vendor={vendor} />
        {!isMissing(vendor.notes) && (
          <p className="text-xs text-muted leading-relaxed border-l-2 border-line pl-3 mt-5">
            {text(vendor.notes)}
          </p>
        )}
      </Panel>

      {/* 2. Independent assays */}
      <Panel className="p-5 border-line-bright">
        <PanelHeader
          icon="solar:test-tube-linear"
          title="2. Independent assays"
          action={
            <span className="readout text-[11px] text-faint">
              {assays.length} on file
            </span>
          }
        />
        <SectionCaption tone="evidence">
          Measured by a third-party lab that the vendor does not control. This is the only section on
          this page that is evidence. Everything below it is somebody talking. Evidence still only
          covers the axes that were actually run, so what was run is stated first.
        </SectionCaption>
        {assays.length === 0 ? (
          <NothingOnFile
            title="No independent assay on file"
            body="Nobody has independently tested what this vendor sells, or if they have, the result has not reached us. This is not a neutral fact and it is not a pass. It means purity, identity, dose, endotoxin, heavy metals, and sterility are all unverified."
          />
        ) : (
          <>
            <AxisCoverage tested={tested} />
            <div className="space-y-3">
              {assays.map((assay, i) => (
                <AssayCard key={`assay-${i}`} assay={assay} />
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* 3. Vendor claims */}
      <div className="pl-4 md:pl-8 border-l border-line">
        <Panel className="p-4 bg-surface-2/20">
          <PanelHeader
            icon="solar:chat-round-unread-linear"
            title="3. Vendor claims"
            action={
              <span className="readout text-[11px] text-faint">{claims.length} on file</span>
            }
          />
          <SectionCaption tone="claim">
            The vendor's own unverified statements about itself. Not independently checked and not
            evidence. A vendor asserting that it is third-party tested is a claim. Only the assays in
            section 2 are results.
          </SectionCaption>
          {claims.length === 0 ? (
            <NothingOnFile
              title="No vendor claim on file"
              body="This vendor has not made any statement to PepHouse about testing, labs, or GMP. Nothing has been asserted, and separately, nothing has been measured."
            />
          ) : (
            <div className="space-y-3">
              {claims.map((claim, i) => (
                <ClaimCard key={`claim-${i}`} claim={claim} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 4. Member reports */}
      <div className="pl-8 md:pl-16 border-l border-line">
        <Panel className="p-4 bg-surface-2/20">
          <PanelHeader
            icon="solar:users-group-rounded-linear"
            title="4. Member reports"
            action={
              <span className="readout text-[11px] text-faint">{reports.length} on file</span>
            }
          />
          <SectionCaption tone="anecdote">
            What buyers say. Self-reported, unverified, and the weakest grade of information on this
            page. A member saying a batch was lab-tested is not a lab test.
          </SectionCaption>
          {reports.length === 0 ? (
            <NothingOnFile
              title="No member reports on file"
              body="No buyer has reported back on this vendor. Silence is not a recommendation and it is not a warning. It is an absence."
            />
          ) : (
            <div className="space-y-3">
              {reports.map((report, i) => (
                <ReportCard key={`report-${i}`} report={report} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 5. Sourcing */}
      <Panel className="p-5">
        <PanelHeader
          icon="solar:box-linear"
          title="5. Sourcing"
          action={
            <span className="readout text-[11px] text-faint">{sourcing.length} on file</span>
          }
        />
        {sourcing.length === 0 ? (
          <NothingOnFile
            title="No sourcing data on file"
            body="Where this product is made, where it ships from, and how it is paid for are all unrecorded. Origin is one of the strongest signals available when there is no assay, and here there is none of either."
          />
        ) : (
          <div className="space-y-3">
            {sourcing.map((row, i) => (
              <SourcingCard key={`sourcing-${i}`} row={row} />
            ))}
          </div>
        )}
      </Panel>

      {/* Two write paths: a buyer report and a vendor statement. Both are
          review-gated and publish labelled unverified. */}
      <ContributeSection vendor={vendor} />
    </div>
  );
}

// ------------------------------------------------------------------ the page

export default function VendorsPage() {
  useDocumentTitle("PepHouse | Vendors");

  const [params, setParams] = useSearchParams();
  const selectedId = useMemo<number | null>(() => {
    const raw = params.get("vendor");
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, [params]);

  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [detail, setDetail] = useState<VendorBreakdown | null>(null);
  // Seeded from the URL. A deep link to ?vendor=3 must paint "Loading" on the
  // first frame, not an empty column while the effect catches up.
  const [detailLoading, setDetailLoading] = useState<boolean>(() => selectedId !== null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(async (): Promise<void> => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await fetchVendors();
      setVendors(data ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "could not load the vendor index");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    fetchVendor(selectedId)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setDetailError(err instanceof Error ? err.message : "could not load this vendor");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const openVendor = useCallback(
    (id: number): void => {
      setParams({ vendor: String(id) });
    },
    [setParams],
  );

  const closeVendor = useCallback((): void => {
    setParams({});
  }, [setParams]);

  const tally = useMemo(() => {
    const byStatus: Record<TestingStatus, number> = {
      independent: 0,
      vendor_claim: 0,
      none: 0,
    };
    let assays = 0;
    let claims = 0;
    let reports = 0;
    // Vendors that HAVE independent testing and are still unmeasured on an axis
    // that hurts people. The most misread population in the index.
    let gapped = 0;
    for (const vendor of vendors) {
      // An unrecognised grade off the wire counts as "none", never as evidence,
      // and never as NaN.
      const status: TestingStatus =
        vendor.testing_status in byStatus ? vendor.testing_status : "none";
      byStatus[status] += 1;
      assays += count(vendor.independent_assays);
      claims += count(vendor.vendor_claims);
      reports += count(vendor.member_reports);
      if (count(vendor.independent_assays) > 0 && safetyGap(vendor.tested_axes).length > 0) {
        gapped += 1;
      }
    }
    return { byStatus, assays, claims, reports, gapped };
  }, [vendors]);

  const sorted = useMemo(() => {
    return vendors
      .slice()
      .sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
      );
  }, [vendors]);

  return (
    <AppShell>
      <header className="h-16 flex items-center justify-between px-8 border-b border-line shrink-0 z-10 bg-base/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-lg font-semibold tracking-tight text-ink flex items-center gap-2">
            <Icon icon="solar:shop-2-linear" className="text-signal text-xl" />
            Vendors
          </h1>
          <div className="h-4 w-px bg-line" />
          <span className="text-xs font-medium text-muted bg-surface border border-line px-2 py-1 rounded-full">
            <span className="readout">{vendors.length}</span> in the index
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void loadList()}
            disabled={listLoading}
            className="text-xs font-medium text-muted hover:text-ink transition-colors flex items-center gap-1.5 disabled:opacity-60"
          >
            <Icon icon="solar:refresh-linear" className={listLoading ? "animate-spin" : ""} />
            Refresh
          </button>
          <Link
            to="/vendors/submit"
            className="text-xs font-medium text-signal hover:text-signal-bright transition-colors flex items-center gap-1.5"
          >
            <Icon icon="solar:add-circle-linear" />
            Submit a vendor
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 z-10">
        {selectedId !== null ? (
          detailLoading ? (
            <p className="text-sm text-faint">Loading vendor…</p>
          ) : detailError !== null ? (
            <Panel className="p-4 max-w-2xl">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-danger">{detailError}</p>
                <button
                  type="button"
                  onClick={closeVendor}
                  className="text-xs font-medium text-muted hover:text-ink border border-line rounded px-2 py-1 transition-colors shrink-0"
                >
                  Back to all vendors
                </button>
              </div>
            </Panel>
          ) : detail !== null ? (
            <VendorDetail vendor={detail} onBack={closeVendor} />
          ) : (
            // Not loading, no error, no vendor. Say so rather than render a blank page.
            <Panel className="p-8 max-w-2xl">
              <div className="flex flex-col items-center text-center gap-2">
                <Icon icon="solar:file-corrupted-linear" className="text-3xl text-faint" />
                <p className="text-ink font-medium">No such vendor in the index</p>
                <p className="text-sm text-faint max-w-md leading-relaxed">
                  Vendor #{selectedId} is not on file. Nothing is listed here that we do not have a
                  record for.
                </p>
                <button
                  type="button"
                  onClick={closeVendor}
                  className="mt-2 text-xs font-medium text-muted hover:text-ink border border-line rounded px-2 py-1 transition-colors"
                >
                  Back to all vendors
                </button>
              </div>
            </Panel>
          )
        ) : (
          <div className="max-w-6xl space-y-5">
            {/* the honest line of context */}
            <Panel className="p-5">
              <p className="text-sm text-muted leading-relaxed max-w-3xl">
                This index is small and it is growing. PepHouse takes no money from vendors. No vendor
                can pay for placement, for a rating, or for a better testing grade, and the list below
                is ordered alphabetically rather than ranked. Where a vendor has never been
                independently tested, this page says so in plain words instead of leaving the cell
                blank. Where a vendor has been tested, it also says which axes that testing skipped:
                a purity certificate is not a safety result, and a testing grade here is a statement
                about who measured what, never a statement that a product is safe.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <Link
                  to="/vendors/submit"
                  className="text-xs font-medium text-signal hover:text-signal-bright transition-colors flex items-center gap-1.5"
                >
                  <Icon icon="solar:add-circle-linear" />
                  Add a vendor, or send us an assay we are missing
                </Link>
              </div>
            </Panel>

            {/* how thin the data actually is */}
            {vendors.length > 0 && (
              <Panel className="p-5">
                <PanelHeader icon="solar:chart-square-linear" title="What is actually on file" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {TESTING_ORDER.map((status) => {
                    const meta = TESTING_STATUS[status];
                    const n = tally.byStatus[status];
                    return (
                      <div
                        key={status}
                        className={`rounded-[var(--radius-card)] border px-4 py-3 ${meta.badge} ${
                          meta.hatched ? "void-hatch" : ""
                        }`}
                      >
                        <p className="readout text-2xl font-semibold">
                          {n}
                          <span className="text-sm font-normal opacity-60"> of {vendors.length}</span>
                        </p>
                        <p className="text-xs font-medium mt-1 flex items-center gap-1.5">
                          <Icon icon={meta.icon} className="shrink-0" />
                          {meta.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-faint mt-4 leading-relaxed">
                  Across the whole index: {tally.assays} independent{" "}
                  {tally.assays === 1 ? "assay" : "assays"}, {tally.claims} vendor{" "}
                  {tally.claims === 1 ? "claim" : "claims"}, {tally.reports} member{" "}
                  {tally.reports === 1 ? "report" : "reports"}. Assays are the only one of those three
                  numbers that measures anything.
                </p>
                {tally.gapped > 0 && (
                  <p className="text-xs text-signal/80 mt-2 leading-relaxed flex items-start gap-1.5">
                    <Icon icon="solar:shield-cross-linear" className="shrink-0 mt-0.5" />
                    <span>
                      {tally.gapped} of the {tally.byStatus.independent} independently tested{" "}
                      {tally.byStatus.independent === 1 ? "vendor has" : "vendors have"} still never
                      been checked for endotoxin, heavy metals, or sterility. A green testing grade on
                      this page means a lab measured something, not that a product is safe.
                    </span>
                  </p>
                )}
              </Panel>
            )}

            {listError !== null && (
              <Panel className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-danger">{listError}</p>
                  <button
                    type="button"
                    onClick={() => void loadList()}
                    disabled={listLoading}
                    className="text-xs font-medium text-muted hover:text-ink border border-line rounded px-2 py-1 transition-colors disabled:opacity-60 shrink-0"
                  >
                    Retry
                  </button>
                </div>
              </Panel>
            )}

            {listLoading && vendors.length === 0 ? (
              <p className="text-sm text-faint">Loading the vendor index…</p>
            ) : listError !== null && vendors.length === 0 ? null : vendors.length === 0 ? (
              <Panel className="p-8">
                <div className="flex flex-col items-center text-center gap-2">
                  <Icon icon="solar:shop-2-linear" className="text-3xl text-faint" />
                  <p className="text-ink font-medium">No vendors in the index yet</p>
                  <p className="text-sm text-faint max-w-md leading-relaxed">
                    The index starts empty and fills up from submissions and lab results. Nothing is
                    listed here that we do not have a record for.
                  </p>
                  <Link
                    to="/vendors/submit"
                    className="mt-2 text-xs font-medium text-signal hover:text-signal-bright transition-colors flex items-center gap-1.5"
                  >
                    <Icon icon="solar:add-circle-linear" />
                    Submit the first one
                  </Link>
                </div>
              </Panel>
            ) : (
              <Panel className="overflow-hidden">
                <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-line bg-surface-2/40">
                  <span className="col-span-3 eyebrow !text-[10px]">Vendor</span>
                  <span className="col-span-2 eyebrow !text-[10px]">Country</span>
                  <span className="col-span-2 eyebrow !text-[10px]">Source type</span>
                  <span className="col-span-3 eyebrow !text-[10px] !text-muted">Testing status</span>
                  <span className="col-span-2 eyebrow !text-[10px] justify-self-end">
                    Assays / claims / reports
                  </span>
                </div>
                {sorted.map((vendor) => (
                  <VendorRow key={vendor.id} vendor={vendor} onOpen={openVendor} />
                ))}
              </Panel>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
