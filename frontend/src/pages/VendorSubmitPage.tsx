import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { AppShell } from "../components/layout/AppShell";
import { Panel } from "../components/ui/Panel";
import { PanelHeader } from "../components/ui/PanelHeader";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { submitVendor } from "../lib/pephouse";
import type { VendorSubmissionInput, VendorSubmissionResult } from "../lib/pephouse";

// Vendor onboarding, filled in on a phone at a conference booth by a vendor rep
// or by the operator standing next to them.
//
// The load-bearing part of this screen is not the fields, it is the honesty of
// what the fields mean. Everything typed here is a CLAIM. A vendor saying it is
// third-party tested is not an assay, and this form says so at the moment the
// rep taps "Yes" rather than in fine print underneath. The tri-states exist for
// the same reason: an unanswered question must reach the backend as an absent
// key, never as a silent `false`, because "we did not ask" and "they told us no"
// are different findings. Both publish as "no testing data on file" — which is a
// finding we print, not a blank we hide.

type TriState = "yes" | "no" | "unknown";
type SubmittedBy = "vendor" | "member";
type SourceType =
  | ""
  | "compounding_pharmacy"
  | "vendor_tested"
  | "gray_market"
  | "research_chem"
  | "brand";

interface FormDraft {
  vendorName: string;
  manufacturer: string;
  country: string;
  website: string;
  telegram: string;
  whatsapp: string;
  contactOther: string;
  sourceType: SourceType;
  thirdPartyTested: TriState;
  testLabs: string;
  coaUrl: string;
  gmpCertified: TriState;
  submittedBy: SubmittedBy;
  notes: string;
}

const EMPTY_DRAFT: FormDraft = {
  vendorName: "",
  manufacturer: "",
  country: "",
  website: "",
  telegram: "",
  whatsapp: "",
  contactOther: "",
  sourceType: "",
  thirdPartyTested: "unknown",
  testLabs: "",
  coaUrl: "",
  gmpCertified: "unknown",
  submittedBy: "vendor",
  notes: "",
};

const SOURCE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "", label: "Not stated" },
  { value: "compounding_pharmacy", label: "Compounding pharmacy" },
  { value: "vendor_tested", label: "Gray-market, lab-tested" },
  { value: "gray_market", label: "Gray-market, untested" },
  { value: "research_chem", label: "Research chemical" },
  { value: "brand", label: "Brand / pharma-grade" },
];

const TRI_OPTIONS: { value: TriState; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

const SUBMITTER_OPTIONS: { value: SubmittedBy; title: string; detail: string }[] = [
  { value: "vendor", title: "I am the vendor", detail: "A vendor disclosing itself." },
  { value: "member", title: "I buy from them", detail: "A member reporting a source they use." },
];

const inputClass =
  "w-full bg-[#0a0a0a] border border-zinc-700/80 rounded-lg py-3 px-3.5 text-base text-zinc-200 " +
  "placeholder:text-zinc-600 outline-none focus:border-zinc-500 transition-colors";

/** Unknown must reach the API as an absent key, never as a `false`. */
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

/** Backend fields are nullable. A missing value resolves to null so the caller has
 * to decide what to print, rather than blanking it by accident. */
function backendText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The select is a string element. Narrow it against the options instead of
 * asserting the type onto whatever the DOM handed back. */
function toSourceType(value: string): SourceType {
  const match = SOURCE_OPTIONS.find((option) => option.value === value);
  return match !== undefined ? match.value : "";
}

/** apiJson throws with the raw response body, and FastAPI sends {"detail": "..."}.
 * Show the detail, not the JSON envelope. */
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

function parseLabs(raw: string): string[] {
  return raw
    .split(",")
    .map((lab) => lab.trim())
    .filter((lab) => lab.length > 0);
}

function labsOrUndefined(raw: string): string[] | undefined {
  const labs = parseLabs(raw);
  return labs.length > 0 ? labs : undefined;
}

// The two labels the public index actually prints (VendorsPage TESTING_STATUS).
// This screen previews the index, so it has to quote the index rather than invent
// a friendlier phrasing of it. The third label, "Independent assay", is not
// reachable from this form by design: nothing typed here can produce one.
const INDEX_LABEL_CLAIM = "Vendor claim, no assay";
const INDEX_LABEL_NONE = "No testing data on file";

/**
 * How this submission will read in the public index.
 *
 * Grounded in the backend grader (vendors.py `_testing_status`): a submission is
 * graded `vendor_claim` only when `third_party_tested` is true. A COA link or a
 * lab name on its own does NOT move the grade off `none`. So this returns the
 * claim label for "Yes" and nothing else — a preview that promised otherwise
 * would be lying about the page it is previewing.
 */
function listingLabel(tested: TriState): string {
  return tested === "yes" ? INDEX_LABEL_CLAIM : INDEX_LABEL_NONE;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-300">
        {label}
      </label>
      {hint !== undefined && (
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{hint}</p>
      )}
      <div className="mt-2">{children}</div>
    </div>
  );
}

type NoteTone = "amber" | "zinc";

function Note({ tone, icon, children }: { tone: NoteTone; icon: string; children: ReactNode }) {
  const map: Record<NoteTone, string> = {
    amber: "border-amber-500/20 bg-amber-500/5 text-amber-200/90",
    zinc: "border-zinc-800 bg-zinc-950/60 text-zinc-400",
  };
  const iconTone: Record<NoteTone, string> = {
    amber: "text-amber-400",
    zinc: "text-zinc-500",
  };
  return (
    <div className={`mt-2.5 flex gap-2.5 rounded-lg border px-3 py-2.5 ${map[tone]}`}>
      <Icon icon={icon} className={`text-base shrink-0 mt-0.5 ${iconTone[tone]}`} />
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}

interface TriStateFieldProps {
  label: string;
  hint: string;
  value: TriState;
  onChange: (next: TriState) => void;
}

/**
 * Three equal buttons. The selected state is styled identically whichever answer
 * it is: the form must not reward a vendor for tapping "Yes".
 */
function TriStateField({ label, hint, value, onChange }: TriStateFieldProps) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-300">{label}</p>
      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{hint}</p>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={label}>
        {TRI_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`min-h-13 rounded-lg border px-2 py-3.5 text-base font-medium transition-colors ${
                active
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
                  : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700"
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

/** What came back, paired with what was sent. One object, so the confirmation can
 * never describe a different submission than the one the server accepted. */
interface Receipt {
  result: VendorSubmissionResult;
  draft: FormDraft;
}

export default function VendorSubmitPage() {
  useDocumentTitle("PepHouse | Submit a vendor");
  const { isAnonymous, email } = useAuth();

  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);

  function set<K extends keyof FormDraft>(key: K, value: FormDraft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === "vendorName") setValidationError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    const vendorName = draft.vendorName.trim();
    if (vendorName.length === 0) {
      setValidationError("A vendor name is required. Everything else is optional.");
      nameRef.current?.focus();
      return;
    }

    setValidationError(null);
    setError(null);
    setSubmitting(true);

    // Undefined values are dropped by JSON.stringify, so an unanswered tri-state
    // arrives as an absent key rather than a false.
    const payload: VendorSubmissionInput = {
      vendor_name: vendorName,
      manufacturer: textOrUndefined(draft.manufacturer),
      country: textOrUndefined(draft.country),
      website: textOrUndefined(draft.website),
      telegram: textOrUndefined(draft.telegram),
      whatsapp: textOrUndefined(draft.whatsapp),
      contact_other: textOrUndefined(draft.contactOther),
      source_type: draft.sourceType === "" ? undefined : draft.sourceType,
      third_party_tested: triToBool(draft.thirdPartyTested),
      test_labs: labsOrUndefined(draft.testLabs),
      coa_url: textOrUndefined(draft.coaUrl),
      gmp_certified: triToBool(draft.gmpCertified),
      submitted_by: draft.submittedBy,
      notes: textOrUndefined(draft.notes),
    };

    try {
      const submission = await submitVendor(payload);
      setReceipt({ result: submission, draft: { ...draft, vendorName } });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  /** Booth flow: the operator does this many times in a row. Keep the submitter
   * mode, clear the rest, put the cursor straight back in the name field. */
  function handleSubmitAnother(): void {
    const submittedBy = draft.submittedBy;
    setDraft({ ...EMPTY_DRAFT, submittedBy });
    setReceipt(null);
    setError(null);
    setValidationError(null);
    window.requestAnimationFrame(() => nameRef.current?.focus());
  }

  const labs = parseLabs(draft.testLabs);

  // A COA link or a lab name does not raise the index grade on its own — only a
  // "Yes" on third-party tested does (vendors.py `_testing_status`). A rep who
  // pastes a COA and leaves the question on Unknown is entitled to know that
  // before they submit, not to discover it in the index afterwards.
  const hasTestingArtifact = labs.length > 0 || draft.coaUrl.trim().length > 0;
  const artifactWithoutClaim = hasTestingArtifact && draft.thirdPartyTested !== "yes";

  // Both come back nullable. Resolve them once, here, so the confirmation renders
  // an explicit finding for a missing one instead of a blank or an "undefined".
  const status = receipt !== null ? backendText(receipt.result.status) : null;
  const reference =
    receipt !== null && typeof receipt.result.id === "number" ? receipt.result.id : null;
  const filedAsPending = status === null || status.toLowerCase() === "pending";

  return (
    <AppShell>
      <div className="h-16 flex items-center px-5 sm:px-8 border-b border-zinc-800/60 shrink-0 z-10">
        <h1 className="text-sm font-medium text-white tracking-tight flex items-center gap-2">
          <Icon icon="solar:shop-2-linear" className="text-blue-400" /> Submit a vendor
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto z-10">
        <div className="max-w-xl mx-auto px-5 sm:px-8 py-8 pb-16">
          {receipt !== null ? (
            <div className="space-y-6" role="status">
              <Panel className="p-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
                    <Icon icon="solar:check-read-linear" className="text-lg text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-medium text-white truncate">
                      {receipt.draft.vendorName} submitted
                    </p>
                    {/* Both fields are nullable coming back. A missing status or a
                        missing reference is stated, not quietly dropped. */}
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {status !== null ? `Status: ${status}` : "Status not returned by the server"}
                      {reference !== null
                        ? ` — reference #${reference}`
                        : " — no reference number returned"}
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    How it will read in the index
                  </p>
                  <p className="text-sm text-zinc-200 mt-1.5">
                    {listingLabel(receipt.draft.thirdPartyTested)}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                    {receipt.draft.thirdPartyTested === "yes"
                      ? "Filed as a vendor claim. It stays a claim until we hold an independent lab result, and it is never shown as one."
                      : "No testing data on file is a finding, and we publish it as one. It is not a blank and it is not a penalty."}
                  </p>
                </div>

                {/* The server decides the status. Do not assert "pending review" over
                    the top of a status that says something else. */}
                <p className="mt-4 text-xs text-zinc-500 leading-relaxed">
                  {filedAsPending
                    ? "Nothing is live yet. It goes into the public vendor index once a human has reviewed it, tagged as vendor-submitted and unverified."
                    : "The server filed this with the status shown above. Either way it is tagged vendor-submitted and unverified, and only an independent assay outranks it."}
                </p>

                <button
                  type="button"
                  onClick={handleSubmitAnother}
                  className="mt-5 w-full min-h-13 rounded-lg bg-blue-500/10 border border-blue-500/40 py-3.5 text-base font-medium text-blue-300 hover:bg-blue-500/15 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon icon="solar:add-circle-linear" className="text-lg" />
                  Submit another vendor
                </button>
              </Panel>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Everything on this form is recorded as a claim, not as evidence. Only an
                independent lab assay counts as evidence, and this form cannot produce one. One
                field is required: the vendor name.
              </p>

              {/* ---- who the vendor is ---- */}
              <Panel className="p-5 sm:p-6">
                <PanelHeader icon="solar:shop-2-linear" title="The vendor" />
                <div className="space-y-5">
                  <Field id="vendor-name" label="Vendor name (required)">
                    <input
                      id="vendor-name"
                      ref={nameRef}
                      type="text"
                      value={draft.vendorName}
                      onChange={(e) => set("vendorName", e.target.value)}
                      placeholder="The name people buy under"
                      autoComplete="off"
                      autoCapitalize="words"
                      aria-invalid={validationError !== null}
                      aria-describedby={validationError !== null ? "vendor-name-error" : undefined}
                      className={`${inputClass} ${
                        validationError !== null ? "border-red-500/60" : ""
                      }`}
                    />
                    {validationError !== null && (
                      <p id="vendor-name-error" role="alert" className="mt-2 text-xs text-red-400">
                        {validationError}
                      </p>
                    )}
                  </Field>

                  <Field
                    id="manufacturer"
                    label="Manufacturer"
                    hint="Who actually makes it, if that is a different company."
                  >
                    <input
                      id="manufacturer"
                      type="text"
                      value={draft.manufacturer}
                      onChange={(e) => set("manufacturer", e.target.value)}
                      placeholder="Optional"
                      autoComplete="off"
                      className={inputClass}
                    />
                  </Field>

                  <Field id="country" label="Country">
                    <input
                      id="country"
                      type="text"
                      value={draft.country}
                      onChange={(e) => set("country", e.target.value)}
                      placeholder="Where it ships from"
                      autoComplete="off"
                      className={inputClass}
                    />
                  </Field>

                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Contact
                      </p>
                      <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                        Many sources operate on Telegram or WhatsApp and have no website, so a
                        website is optional — a channel is enough.
                      </p>
                    </div>

                    <Field id="website" label="Website">
                      <input
                        id="website"
                        type="url"
                        inputMode="url"
                        value={draft.website}
                        onChange={(e) => set("website", e.target.value)}
                        placeholder="https://"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className={inputClass}
                      />
                    </Field>

                    <Field id="telegram" label="Telegram" hint="Handle or invite link.">
                      <input
                        id="telegram"
                        type="text"
                        value={draft.telegram}
                        onChange={(e) => set("telegram", e.target.value)}
                        placeholder="@handle or t.me/..."
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className={inputClass}
                      />
                    </Field>

                    <Field id="whatsapp" label="WhatsApp" hint="Number or wa.me link.">
                      <input
                        id="whatsapp"
                        type="text"
                        value={draft.whatsapp}
                        onChange={(e) => set("whatsapp", e.target.value)}
                        placeholder="+1... or wa.me/..."
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className={inputClass}
                      />
                    </Field>

                    <Field
                      id="contact-other"
                      label="Other contact — Signal, Wickr, email, forum handle"
                    >
                      <input
                        id="contact-other"
                        type="text"
                        value={draft.contactOther}
                        onChange={(e) => set("contactOther", e.target.value)}
                        placeholder="Optional"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <Field id="source-type" label="Source type">
                    <div className="relative">
                      <select
                        id="source-type"
                        value={draft.sourceType}
                        onChange={(e) => set("sourceType", toSourceType(e.target.value))}
                        className={`${inputClass} appearance-none pr-10`}
                      >
                        {SOURCE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Icon
                        icon="solar:alt-arrow-down-linear"
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                      />
                    </div>
                  </Field>
                </div>
              </Panel>

              {/* ---- testing: the honest part ---- */}
              <Panel className="p-5 sm:p-6">
                <PanelHeader icon="solar:flask-linear" title="Testing" />
                <div className="space-y-5">
                  <TriStateField
                    label="Third-party tested"
                    hint="What the vendor says about itself. Leave it on Unknown if nobody in front of you actually knows."
                    value={draft.thirdPartyTested}
                    onChange={(next) => set("thirdPartyTested", next)}
                  />

                  {draft.thirdPartyTested === "yes" && (
                    <Note tone="amber" icon="solar:danger-triangle-linear">
                      Recorded as a vendor claim. A claim is not an assay. It reads as{" "}
                      {INDEX_LABEL_CLAIM} in the index until we hold an independent lab result of
                      our own, and it is never shown as an independent result.
                    </Note>
                  )}
                  {draft.thirdPartyTested === "no" && (
                    <Note tone="zinc" icon="solar:info-circle-linear">
                      Listed as: {INDEX_LABEL_NONE}. That is a finding, and we print it.
                    </Note>
                  )}
                  {draft.thirdPartyTested === "unknown" && (
                    <Note tone="zinc" icon="solar:info-circle-linear">
                      Left unanswered. Listed as: {INDEX_LABEL_NONE}. Unknown is not recorded as a
                      No, and it is never rounded up into a Yes.
                    </Note>
                  )}

                  <Field
                    id="test-labs"
                    label="Testing labs"
                    hint="Comma separated. Naming the lab is what makes the claim checkable."
                  >
                    <input
                      id="test-labs"
                      type="text"
                      value={draft.testLabs}
                      onChange={(e) => set("testLabs", e.target.value)}
                      placeholder="Janoshik, Colmaric"
                      autoComplete="off"
                      autoCapitalize="words"
                      className={inputClass}
                    />
                    {labs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {labs.map((lab, i) => (
                          <span
                            key={`${lab}-${i}`}
                            className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800/60 text-xs text-zinc-300"
                          >
                            {lab}
                          </span>
                        ))}
                      </div>
                    )}
                  </Field>

                  <Field id="coa-url" label="Certificate of analysis (link)">
                    <input
                      id="coa-url"
                      type="url"
                      inputMode="url"
                      value={draft.coaUrl}
                      onChange={(e) => set("coaUrl", e.target.value)}
                      placeholder="https://"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className={inputClass}
                    />
                    <Note tone="zinc" icon="solar:document-text-linear">
                      A COA you hand us is still a vendor-supplied document. It is filed under the
                      vendor's claim, not as an independent assay, until we verify it ourselves.
                    </Note>
                  </Field>

                  {artifactWithoutClaim && (
                    <Note tone="amber" icon="solar:danger-triangle-linear">
                      Third-party tested is not set to Yes, so this still reads as{" "}
                      {INDEX_LABEL_NONE} in the index. A lab name or a COA link does not raise the
                      grade on its own, and neither one is an independent assay. If the vendor does
                      claim third-party testing, answer Yes above.
                    </Note>
                  )}

                  <TriStateField
                    label="GMP certified"
                    hint="Same rule as above. Unknown stays Unknown."
                    value={draft.gmpCertified}
                    onChange={(next) => set("gmpCertified", next)}
                  />
                  {draft.gmpCertified === "yes" && (
                    <Note tone="amber" icon="solar:danger-triangle-linear">
                      Recorded as a vendor claim until we see the certificate.
                    </Note>
                  )}
                </div>
              </Panel>

              {/* ---- who is filling this in ---- */}
              <Panel className="p-5 sm:p-6">
                <PanelHeader icon="solar:user-check-linear" title="Who is submitting" />
                <div
                  className="space-y-2"
                  role="radiogroup"
                  aria-label="Who is submitting this vendor"
                >
                  {SUBMITTER_OPTIONS.map((option) => {
                    const active = draft.submittedBy === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => set("submittedBy", option.value)}
                        className={`w-full text-left rounded-lg border px-4 py-3.5 min-h-13 transition-colors ${
                          active
                            ? "border-blue-500/50 bg-blue-500/10"
                            : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                        }`}
                      >
                        <span
                          className={`block text-base font-medium ${
                            active ? "text-blue-300" : "text-zinc-300"
                          }`}
                        >
                          {option.title}
                        </span>
                        <span className="block text-xs text-zinc-500 mt-0.5">{option.detail}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5">
                  <Field
                    id="notes"
                    label="Notes"
                    hint="Anything a buyer would want to know. It publishes as written."
                  >
                    <textarea
                      id="notes"
                      rows={3}
                      value={draft.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="Optional"
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                </div>
              </Panel>

              {/* ---- the disclosure. This is the product. ---- */}
              <Panel className="p-5 sm:p-6 border-blue-500/25">
                <PanelHeader icon="solar:shield-check-linear" title="What happens to this" />
                <ul className="space-y-3 text-sm text-zinc-300 leading-relaxed">
                  <li className="flex gap-2.5">
                    <Icon
                      icon="solar:eye-linear"
                      className="text-blue-400 text-base shrink-0 mt-0.5"
                    />
                    <span>
                      What you submit is published publicly in the vendor index. Anyone can read
                      it.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <Icon
                      icon="solar:tag-linear"
                      className="text-blue-400 text-base shrink-0 mt-0.5"
                    />
                    <span>
                      It is tagged vendor-submitted and unverified. It is not presented as an
                      independent lab result, because it is not one.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <Icon
                      icon="solar:magnifer-linear"
                      className="text-blue-400 text-base shrink-0 mt-0.5"
                    />
                    <span>
                      We may independently verify it. If an independent assay contradicts what you
                      enter here, the assay is what we publish.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <Icon
                      icon="solar:file-remove-linear"
                      className="text-blue-400 text-base shrink-0 mt-0.5"
                    />
                    <span>
                      Vendors with no testing data on file are listed as having no testing data on
                      file. We do not hide the gap.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <Icon
                      icon="solar:hand-money-linear"
                      className="text-blue-400 text-base shrink-0 mt-0.5"
                    />
                    <span>
                      We take no money from vendors. You cannot pay for a listing, a rating, or a
                      position in the index.
                    </span>
                  </li>
                </ul>
                <p className="mt-4 pt-4 border-t border-zinc-800 text-sm text-zinc-300">
                  Submitting is your consent to all of the above.
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  {isAnonymous || email === null
                    ? "This submission is attached to an anonymous session on this device."
                    : `This submission is attached to ${email}.`}
                </p>
              </Panel>

              {error !== null && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 flex gap-2.5"
                >
                  <Icon
                    icon="solar:close-circle-linear"
                    className="text-red-400 text-base shrink-0 mt-0.5"
                  />
                  <p className="text-sm text-red-300 leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-14 rounded-lg bg-blue-500/15 border border-blue-500/50 py-4 text-base font-medium text-blue-200 hover:bg-blue-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Icon icon="svg-spinners:180-ring" className="text-lg" />
                    Submitting
                  </>
                ) : (
                  <>
                    <Icon icon="solar:upload-linear" className="text-lg" />
                    Submit for review
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
