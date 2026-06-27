import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchUserData,
  importLabs,
  importLink,
  importProfile,
  saveUserData,
} from "../lib/api";
import { getUserRef } from "../lib/userRef";
import type { ImportPatch, LabValue } from "../types/simulation";

export type FlowState = "idle" | "working" | "done" | "error";

const POLL_INTERVAL_MS = 2_500;
const MAX_POLLS = 16;

/** Junction import state for the Digital Twin page.
 *
 * `connected` is a SESSION flag — it only becomes true once the user actively
 * links data this session (pull bloodwork / connect wearable). Saved data is
 * hydrated into the editable profile form on mount, but does NOT auto-activate
 * the twin, so the "link your data" gate always shows first. */
export function useImport() {
  const [device, setDevice] = useState<FlowState>("idle");
  const [bloodwork, setBloodwork] = useState<FlowState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Accumulated patient picture.
  const [age, setAge] = useState<number | null>(null);
  const [sex, setSex] = useState<"M" | "F" | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [labs, setLabs] = useState<LabValue[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [bloodworkLabel, setBloodworkLabel] = useState<string | null>(null);

  const cancelled = useRef(false);
  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const applyState = useCallback((p: ImportPatch) => {
    if (p.age != null) setAge(p.age);
    if (p.sex) setSex(p.sex);
    if (p.weightKg != null) setWeightKg(p.weightKg);
    if (p.labs && p.labs.length) setLabs(p.labs);
    if (p.conditions && p.conditions.length) setConditions(p.conditions);
    if (p.source?.kind === "device") setDeviceLabel(p.source.label);
    if (p.source?.kind === "bloodwork") setBloodworkLabel(p.source.label);
  }, []);

  // Apply an import + persist it (fire-and-forget). Marks the twin connected.
  const apply = useCallback(
    (p: ImportPatch) => {
      applyState(p);
      setConnected(true);
      saveUserData(getUserRef(), p).catch(() => {});
    },
    [applyState],
  );

  // On mount, hydrate the editable PROFILE (age/sex/weight/conditions/goals)
  // from saved data — but NOT labs and NOT `connected`, so the link-data gate
  // always shows until the user links this session.
  useEffect(() => {
    let alive = true;
    fetchUserData(getUserRef())
      .then((bundle) => {
        if (!alive || !bundle) return;
        if (bundle.age != null) setAge(bundle.age);
        if (bundle.sex) setSex(bundle.sex);
        if (bundle.weight_kg != null) setWeightKg(bundle.weight_kg);
        if (bundle.conditions?.length) setConditions(bundle.conditions);
        if (bundle.goals?.length) setGoals(bundle.goals);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const checkProfile = useCallback(async (): Promise<boolean> => {
    const { connected: linked, patch } = await importProfile(getUserRef());
    if (linked && patch) {
      apply(patch);
      setDevice("done");
      return true;
    }
    return false;
  }, [apply]);

  const connectDevice = useCallback(async () => {
    setError(null);
    setDevice("working");
    try {
      const { link_url } = await importLink(getUserRef());
      window.open(link_url, "_blank", "noopener,noreferrer");
      cancelled.current = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_INTERVAL_MS);
        if (cancelled.current) return;
        if (await checkProfile()) return;
      }
      setDevice("error");
      setError("Finish linking in the Junction tab, then tap “I've connected”.");
    } catch (e) {
      setDevice("error");
      setError(e instanceof Error ? e.message : "Could not start the connect flow.");
    }
  }, [checkProfile]);

  const recheckDevice = useCallback(async () => {
    setError(null);
    setDevice("working");
    try {
      if (!(await checkProfile())) {
        setDevice("error");
        setError("No provider linked yet. Complete the Junction tab first.");
      }
    } catch (e) {
      setDevice("error");
      setError(e instanceof Error ? e.message : "Re-check failed.");
    }
  }, [checkProfile]);

  const pullBloodwork = useCallback(async () => {
    setError(null);
    setBloodwork("working");
    try {
      apply(await importLabs(getUserRef()));
      setBloodwork("done");
    } catch (e) {
      setBloodwork("error");
      setError(e instanceof Error ? e.message : "Could not pull bloodwork.");
    }
  }, [apply]);

  // Reset to the pre-connect (gated) state for this session. Keeps the saved
  // profile fields, but clears the live link so the twin greys out and the
  // link-data gate shows again.
  const disconnect = useCallback(() => {
    cancelled.current = true;
    setConnected(false);
    setLabs([]);
    setDevice("idle");
    setBloodwork("idle");
    setError(null);
    setDeviceLabel(null);
    setBloodworkLabel(null);
  }, []);

  return {
    device,
    bloodwork,
    error,
    connected,
    age,
    sex,
    weightKg,
    labs,
    conditions,
    goals,
    deviceLabel,
    bloodworkLabel,
    connectDevice,
    recheckDevice,
    pullBloodwork,
    disconnect,
  };
}
