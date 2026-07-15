import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Panel } from "../components/ui/Panel";
import { PanelHeader } from "../components/ui/PanelHeader";
import { MultiSelectDropdown } from "../components/twin/MultiSelectDropdown";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useImport } from "../hooks/useImport";
import {
  deleteUserData,
  fetchUserData,
  saveUserData,
  uploadLabReport,
  type DeleteUserDataResult,
} from "../lib/api";
import { getUserRef } from "../lib/userRef";
import { CONDITION_OPTIONS, GOAL_OPTIONS } from "../data/profileOptions";

type SaveState = "idle" | "saving" | "saved" | "error";
type UploadState = "idle" | "uploading" | "done" | "error";
type DeleteStep = "idle" | "confirm" | "deleting" | "done" | "error";

interface ProfileDraft {
  age: number | null;
  sex: "M" | "F" | null;
  weightKg: number | null;
  conditions: string[];
  goals: string[];
}

const EMPTY_PROFILE: ProfileDraft = {
  age: null,
  sex: null,
  weightKg: null,
  conditions: [],
  goals: [],
};

const inputClass =
  "w-full bg-base border border-line rounded-lg py-2 px-3 text-sm text-ink outline-none focus:border-signal transition-colors";

function SectionLabel({ children }: { children: string }) {
  return <label className="text-[12px] font-medium text-faint mb-1.5 block">{children}</label>;
}

function StatusDot({ on }: { on: boolean }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${on ? "bg-measured" : "bg-ghost"}`} />;
}

// Human labels for the per-table delete counts, matching the keys the backend
// returns from DELETE /users/{ref}/data (fall back to the raw key).
const TABLE_LABELS: Record<string, string> = {
  user_profiles: "Profile",
  user_lab_results: "Lab results",
  user_wearable_metrics: "Wearable metrics",
  user_stack: "Stack items",
  trial_intakes: "Trial intakes",
};

export default function SettingsPage() {
  useDocumentTitle("PepHouse | Settings");
  const { userRef, isAnonymous, email, signInWithGoogle, signOut } = useAuth();
  const imp = useImport();

  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // ---- Profile ----
  const [profile, setProfile] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let alive = true;
    fetchUserData(getUserRef())
      .then((bundle) => {
        if (!alive) return;
        setProfile({
          age: bundle?.age ?? null,
          sex: bundle?.sex ?? null,
          weightKg: bundle?.weight_kg ?? null,
          conditions: bundle?.conditions ?? [],
          goals: bundle?.goals ?? [],
        });
        setProfileLoaded(true);
      })
      .catch(() => {
        if (alive) setProfileLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const editProfile = (partial: Partial<ProfileDraft>) => {
    setProfile((prev) => ({ ...prev, ...partial }));
    setSaveState("idle");
  };

  const handleSaveProfile = async () => {
    setSaveState("saving");
    try {
      // saveUserData omits null demographics and untouched labs, so a
      // profile-only edit never wipes stored biomarkers.
      await saveUserData(getUserRef(), {
        ...(profile.age != null ? { age: profile.age } : {}),
        ...(profile.sex ? { sex: profile.sex } : {}),
        ...(profile.weightKg != null ? { weightKg: profile.weightKg } : {}),
        conditions: profile.conditions,
        goals: profile.goals,
        source: { kind: "reported", label: "Settings", at: new Date().toISOString() },
      });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  };

  // ---- Lab PDF upload ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadCount, setUploadCount] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setUploadState("uploading");
    setUploadError(null);
    setUploadCount(null);
    try {
      const result = await uploadLabReport(getUserRef(), file);
      setUploadCount(result.extracted_count);
      setUploadState("done");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
      setUploadState("error");
    }
  };

  // ---- Data rights ----
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("idle");
  const [deleteInput, setDeleteInput] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteUserDataResult | null>(null);

  const handleExport = async () => {
    setExportError(null);
    try {
      const bundle = await fetchUserData(getUserRef());
      if (!bundle) {
        setExportError("Nothing stored yet — there is no data to export.");
        return;
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pephouse-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  };

  const handleDelete = async () => {
    setDeleteStep("deleting");
    setDeleteError(null);
    try {
      const result = await deleteUserData(getUserRef());
      setDeleteResult(result);
      setDeleteStep("done");
      // Clear the local mirrors of the deleted data: connection state,
      // cached labs / wearable metrics, and the profile form.
      imp.disconnect();
      setProfile(EMPTY_PROFILE);
      setSaveState("idle");
      setUploadState("idle");
      setUploadCount(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed.");
      setDeleteStep("error");
    }
  };

  const handleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOut();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-out failed. Try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const deleteArmed = deleteInput.trim() === "DELETE";

  return (
    <AppShell>
      <div className="h-16 flex items-center px-8 border-b border-line shrink-0 z-10">
        <h1 className="font-display text-sm font-medium text-ink tracking-tight flex items-center gap-2">
          <Icon icon="solar:settings-linear" className="text-signal" /> Settings
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10 space-y-8">
          {/* 1 — Account */}
          <Panel className="p-6">
            <PanelHeader icon="solar:user-linear" title="Account" />
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-surface-2 border border-line flex items-center justify-center shrink-0">
                <Icon
                  icon={isAnonymous ? "solar:incognito-linear" : "solar:user-linear"}
                  className="text-base text-ink"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink truncate">
                  {isAnonymous ? "Guest" : email ?? "Signed in"}
                </div>
                <div className="text-[11px] text-faint truncate font-mono" title={userRef}>
                  {isAnonymous ? "Anonymous session — data is tied to this browser" : userRef}
                </div>
              </div>
              {isAnonymous ? (
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={authBusy}
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md border border-line hover:border-line-bright hover:bg-surface transition-colors text-sm font-medium text-ink disabled:opacity-50"
                >
                  <Icon icon="solar:login-3-linear" className="text-base text-signal" />
                  {authBusy ? "Redirecting" : "Sign in with Google"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={authBusy}
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted hover:text-ink hover:bg-surface transition-colors disabled:opacity-50"
                >
                  <Icon icon="solar:logout-3-linear" className="text-base" />
                  Sign out
                </button>
              )}
            </div>
            {isAnonymous && (
              <p className="mt-3 text-xs text-faint leading-relaxed">
                Signing in keeps your profile, labs, and stack when you switch devices. Your
                current data carries over.
              </p>
            )}
            {authError && (
              <p className="mt-2 text-[11px] text-danger" role="alert">
                {authError}
              </p>
            )}
          </Panel>

          {/* 2 — Profile */}
          <Panel className="p-6">
            <PanelHeader
              icon="lucide:clipboard-list"
              title="Profile"
              action={
                <span className="text-[11px] text-faint">
                  {saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
                </span>
              }
            />
            {!profileLoaded ? (
              <div className="text-sm text-faint flex items-center gap-2 py-4">
                <Icon icon="svg-spinners:180-ring" className="text-signal" /> Loading profile
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <SectionLabel>Age</SectionLabel>
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={profile.age ?? ""}
                      onChange={(e) =>
                        editProfile({ age: e.target.value === "" ? null : Number(e.target.value) })
                      }
                      placeholder="—"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <SectionLabel>Sex</SectionLabel>
                    <select
                      value={profile.sex ?? ""}
                      onChange={(e) =>
                        editProfile({ sex: e.target.value === "" ? null : (e.target.value as "M" | "F") })
                      }
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">—</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                    </select>
                  </div>
                  <div>
                    <SectionLabel>Weight (kg)</SectionLabel>
                    <input
                      type="number"
                      min={0}
                      max={300}
                      value={profile.weightKg ?? ""}
                      onChange={(e) =>
                        editProfile({
                          weightKg: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="—"
                      className={inputClass}
                    />
                  </div>
                </div>

                <MultiSelectDropdown
                  label="Goals"
                  icon="lucide:target"
                  options={GOAL_OPTIONS}
                  selected={profile.goals}
                  onChange={(next) => editProfile({ goals: next })}
                  placeholder="Select your goals…"
                />
                <MultiSelectDropdown
                  label="Conditions"
                  icon="lucide:heart-pulse"
                  options={CONDITION_OPTIONS}
                  selected={profile.conditions}
                  onChange={(next) => editProfile({ conditions: next })}
                  placeholder="Select conditions…"
                />

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={saveState === "saving"}
                  className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${
                    saveState === "saved"
                      ? "bg-measured text-base"
                      : saveState === "error"
                        ? "bg-danger text-base"
                        : "bg-signal hover:bg-signal-bright text-on-signal"
                  }`}
                >
                  <Icon
                    icon={
                      saveState === "saving"
                        ? "svg-spinners:180-ring"
                        : saveState === "saved"
                          ? "lucide:check"
                          : "lucide:save"
                    }
                    className="w-4 h-4"
                  />
                  {saveState === "saving"
                    ? "Saving…"
                    : saveState === "saved"
                      ? "Saved"
                      : saveState === "error"
                        ? "Retry save"
                        : "Save profile"}
                </button>
              </div>
            )}
          </Panel>

          {/* 3 — Connected data */}
          <Panel className="p-6">
            <PanelHeader icon="lucide:plug-zap" title="Connected data" />
            <div className="space-y-3">
              {/* Blood panel */}
              <div
                className={`flex items-center gap-3 rounded-lg border border-line bg-base/40 px-4 py-3 ${
                  imp.bloodworkConnected ? "" : "void-hatch"
                }`}
              >
                <Icon icon="lucide:test-tube" className="w-4 h-4 text-measured shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink flex items-center gap-2">
                    Blood panel <StatusDot on={imp.bloodworkConnected} />
                  </div>
                  <div className="text-[11px] text-faint truncate">
                    {imp.bloodworkConnected
                      ? `${imp.bloodworkLabel ?? "Junction lab results"} · ${imp.labs.length} biomarkers`
                      : "Not connected"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={imp.pullBloodwork}
                  disabled={imp.bloodwork === "working"}
                  className="shrink-0 rounded-lg border border-line bg-base hover:border-signal px-3 py-1.5 text-xs font-medium text-ink flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  <Icon
                    icon={imp.bloodwork === "working" ? "svg-spinners:180-ring" : "lucide:download"}
                    className="text-signal"
                  />
                  {imp.bloodwork === "working" ? "Pulling…" : imp.bloodworkConnected ? "Re-pull" : "Pull"}
                </button>
              </div>

              {/* Wearable */}
              <div
                className={`flex items-center gap-3 rounded-lg border border-line bg-base/40 px-4 py-3 ${
                  imp.wearableConnected ? "" : "void-hatch"
                }`}
              >
                <Icon icon="lucide:watch" className="w-4 h-4 text-measured shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink flex items-center gap-2">
                    Wearable <StatusDot on={imp.wearableConnected} />
                    {imp.wearableConnected && imp.wearableMocked && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-signal/40 bg-signal/10 text-signal uppercase tracking-wider">
                        Demo data
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-faint truncate">
                    {imp.wearableConnected
                      ? imp.deviceLabel ?? "Oura / WHOOP via Junction"
                      : "Not connected"}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={imp.pullWearable}
                    disabled={imp.wearableState === "working"}
                    className="rounded-lg border border-line bg-base hover:border-signal px-3 py-1.5 text-xs font-medium text-ink flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Icon
                      icon={imp.wearableState === "working" ? "svg-spinners:180-ring" : "lucide:download"}
                      className="text-signal"
                    />
                    {imp.wearableState === "working" ? "Pulling…" : imp.wearableConnected ? "Re-pull" : "Pull"}
                  </button>
                  <button
                    type="button"
                    onClick={imp.connectDevice}
                    disabled={imp.device === "working"}
                    className="rounded-lg border border-line bg-base hover:border-signal px-3 py-1.5 text-xs font-medium text-ink flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Icon
                      icon={imp.device === "working" ? "svg-spinners:180-ring" : "lucide:link"}
                      className="text-signal"
                    />
                    Re-link
                  </button>
                </div>
              </div>

              {imp.error && <p className="text-[11px] text-danger">{imp.error}</p>}

              {/* Lab PDF upload */}
              <div className="rounded-lg border border-dashed border-line bg-base/40 px-4 py-4">
                <div className="flex items-center gap-3">
                  <Icon icon="lucide:file-text" className="w-4 h-4 text-measured shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">Upload lab report (PDF)</div>
                    <div className="text-[11px] text-faint">
                      Biomarkers are extracted and merged onto your stored labs.
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUpload(file);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadState === "uploading"}
                    className="shrink-0 rounded-lg border border-line bg-base hover:border-signal px-3 py-1.5 text-xs font-medium text-ink flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <Icon
                      icon={uploadState === "uploading" ? "svg-spinners:180-ring" : "lucide:upload"}
                      className="text-signal"
                    />
                    {uploadState === "uploading" ? "Extracting…" : "Choose PDF"}
                  </button>
                </div>
                {uploadState === "done" && uploadCount != null && (
                  <p className="mt-2 text-[11px] text-measured flex items-center gap-1">
                    <Icon icon="lucide:check" className="w-3 h-3" />
                    {uploadCount === 0
                      ? "Processed, but no biomarkers were found in that PDF."
                      : `Extracted ${uploadCount} biomarker${uploadCount === 1 ? "" : "s"} and saved them to your data.`}
                  </p>
                )}
                {uploadState === "error" && uploadError && (
                  <p className="mt-2 text-[11px] text-danger">{uploadError}</p>
                )}
              </div>
            </div>
          </Panel>

          {/* 4 — Data rights */}
          <Panel className="p-6">
            <PanelHeader icon="lucide:shield" title="Data rights" />
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-line bg-base/40 px-4 py-3">
                <Icon icon="lucide:archive" className="w-4 h-4 text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">Export my data</div>
                  <div className="text-[11px] text-faint">
                    Download everything PepHouse stores about you as JSON.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleExport}
                  className="shrink-0 rounded-lg border border-line bg-base hover:border-line-bright px-3 py-1.5 text-xs font-medium text-ink flex items-center gap-1.5 transition-colors"
                >
                  <Icon icon="lucide:download" />
                  Export
                </button>
              </div>
              {exportError && <p className="text-[11px] text-danger">{exportError}</p>}

              <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Icon icon="lucide:trash-2" className="w-4 h-4 text-danger shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">Delete my data</div>
                    <div className="text-[11px] text-faint">
                      Permanently removes your profile, labs, wearable data, and stack. This cannot
                      be undone.
                    </div>
                  </div>
                  {deleteStep === "idle" || deleteStep === "error" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteStep("confirm");
                        setDeleteInput("");
                        setDeleteError(null);
                      }}
                      className="shrink-0 rounded-lg border border-danger/50 bg-base hover:bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger flex items-center gap-1.5 transition-colors"
                    >
                      <Icon icon="lucide:trash-2" />
                      Delete
                    </button>
                  ) : null}
                </div>

                {deleteStep === "confirm" || deleteStep === "deleting" ? (
                  <div className="mt-3 pt-3 border-t border-danger/30 space-y-2">
                    <p className="text-[11px] text-muted">
                      Type <span className="font-mono font-semibold text-danger">DELETE</span> to
                      confirm.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        value={deleteInput}
                        onChange={(e) => setDeleteInput(e.target.value)}
                        placeholder="DELETE"
                        disabled={deleteStep === "deleting"}
                        className="flex-1 bg-base border border-line rounded-lg py-1.5 px-3 text-sm text-ink font-mono outline-none focus:border-danger transition-colors"
                      />
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={!deleteArmed || deleteStep === "deleting"}
                        className="rounded-lg bg-danger/90 hover:bg-danger px-3 py-1.5 text-xs font-semibold text-base flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Icon
                          icon={deleteStep === "deleting" ? "svg-spinners:180-ring" : "lucide:trash-2"}
                        />
                        {deleteStep === "deleting" ? "Deleting…" : "Delete everything"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteStep("idle")}
                        disabled={deleteStep === "deleting"}
                        className="rounded-lg border border-line bg-base px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {deleteStep === "done" && deleteResult && (
                  <div className="mt-3 pt-3 border-t border-danger/30">
                    <p className="text-[11px] text-measured flex items-center gap-1 mb-1.5">
                      <Icon icon="lucide:check" className="w-3 h-3" /> Your data has been deleted.
                    </p>
                    <ul className="space-y-0.5">
                      {Object.entries(deleteResult.tables).map(([table, count]) => (
                        <li key={table} className="text-[11px] text-faint flex justify-between">
                          <span>{TABLE_LABELS[table] ?? table}</span>
                          <span className="readout text-muted">
                            {count} record{count === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {deleteStep === "error" && deleteError && (
                  <p className="mt-2 text-[11px] text-danger">{deleteError}</p>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
