import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchUserData,
  importLabs,
  importLink,
  importProfile,
  importWearable,
  saveUserData,
  type WearableMetrics,
} from "../lib/api";
import { getUserRef } from "../lib/userRef";
import type { ImportPatch, LabValue } from "../types/simulation";

export type FlowState = "idle" | "working" | "done" | "error";

const POLL_INTERVAL_MS = 2_500;
const MAX_POLLS = 16;

/** Junction import for the Digital Twin. Two independent data sources — a blood
 * panel and a wearable — each connectable / disconnectable this session. The
 * twin is `connected` once EITHER source is linked. Saved data hydrates the
 * profile form on mount but does NOT auto-activate (the gate shows first). */
export function useImport() {
  const [device, setDevice] = useState<FlowState>("idle");
  const [bloodwork, setBloodwork] = useState<FlowState>("idle");
  const [wearableState, setWearableState] = useState<FlowState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [bloodworkConnected, setBloodworkConnected] = useState(false);
  const [wearableConnected, setWearableConnected] = useState(false);

  // Accumulated patient picture.
  const [age, setAge] = useState<number | null>(null);
  const [sex, setSex] = useState<"M" | "F" | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [labs, setLabs] = useState<LabValue[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [wearableMetrics, setWearableMetrics] = useState<WearableMetrics | null>(null);
  const [wearableMocked, setWearableMocked] = useState(false);
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

  const apply = useCallback(
    (p: ImportPatch) => {
      applyState(p);
      saveUserData(getUserRef(), p).catch(() => {});
    },
    [applyState],
  );

  // On mount, hydrate the editable PROFILE only (not labs / not connected).
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
      setBloodworkConnected(true);
    } catch (e) {
      setBloodwork("error");
      setError(e instanceof Error ? e.message : "Could not pull bloodwork.");
    }
  }, [apply]);

  // Actually use Junction: open the hosted Link flow so a real wearable provider
  // (Oura / WHOOP / …) can be connected, then poll Junction for real summaries.
  // Only the metrics Junction doesn't return are mock-filled (sandbox has none
  // until a provider is linked).
  const pullWearable = useCallback(async () => {
    setError(null);
    setWearableState("working");
    try {
      // 1) try real data first (a provider may already be linked)
      let res = await importWearable(getUserRef());
      // 2) if it's all mock, open Junction Link to connect a real provider, then poll
      if (res.mocked) {
        try {
          const { link_url } = await importLink(getUserRef());
          window.open(link_url, "_blank", "noopener,noreferrer");
        } catch {
          /* link unavailable — keep the mock fallback */
        }
        cancelled.current = false;
        for (let i = 0; i < 8 && res.mocked; i++) {
          await sleep(POLL_INTERVAL_MS);
          if (cancelled.current) break;
          res = await importWearable(getUserRef());
        }
      }
      setWearableMetrics(res.metrics);
      setWearableMocked(res.mocked);
      setWearableState("done");
      setWearableConnected(true);
    } catch (e) {
      setWearableState("error");
      setError(e instanceof Error ? e.message : "Could not pull wearable data.");
    }
  }, []);

  const disconnectBloodwork = useCallback(() => {
    setBloodworkConnected(false);
    setLabs([]);
    setBloodwork("idle");
    setBloodworkLabel(null);
  }, []);

  const disconnectWearable = useCallback(() => {
    cancelled.current = true;
    setWearableConnected(false);
    setWearableMetrics(null);
    setWearableState("idle");
    setDevice("idle");
    setDeviceLabel(null);
  }, []);

  const disconnect = useCallback(() => {
    disconnectBloodwork();
    disconnectWearable();
    setError(null);
  }, [disconnectBloodwork, disconnectWearable]);

  const connected = bloodworkConnected || wearableConnected;

  return {
    device,
    bloodwork,
    wearableState,
    error,
    connected,
    bloodworkConnected,
    wearableConnected,
    age,
    sex,
    weightKg,
    labs,
    conditions,
    goals,
    wearableMetrics,
    wearableMocked,
    deviceLabel,
    bloodworkLabel,
    connectDevice,
    recheckDevice,
    pullBloodwork,
    pullWearable,
    disconnect,
    disconnectBloodwork,
    disconnectWearable,
  };
}
