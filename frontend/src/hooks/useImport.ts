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

// Connection state persisted device-side so a refresh doesn't disconnect.
const BLOOD_KEY = "pephouse_blood";
const WEARABLE_KEY = "pephouse_wearable";

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

  // On mount: restore the connection (blood / wearable) from localStorage so a
  // refresh doesn't disconnect, and hydrate the profile + conditions from the DB
  // (defaulting conditions to High cholesterol + Obesity, persisted).
  useEffect(() => {
    let alive = true;
    // restore connection state (device-local, survives refresh)
    try {
      const b = localStorage.getItem(BLOOD_KEY);
      if (b) {
        const saved = JSON.parse(b) as { labs: LabValue[]; label?: string };
        if (saved.labs?.length) {
          setLabs(saved.labs);
          setBloodworkConnected(true);
          setBloodwork("done");
          if (saved.label) setBloodworkLabel(saved.label);
        }
      }
      const w = localStorage.getItem(WEARABLE_KEY);
      if (w) {
        const saved = JSON.parse(w) as { metrics: WearableMetrics; mocked: boolean };
        if (saved.metrics) {
          setWearableMetrics(saved.metrics);
          setWearableMocked(saved.mocked);
          setWearableConnected(true);
          setWearableState("done");
        }
      }
    } catch {
      /* ignore corrupt local state */
    }
    // profile + conditions/goals from the DB
    fetchUserData(getUserRef())
      .then((bundle) => {
        if (!alive) return;
        if (bundle?.age != null) setAge(bundle.age);
        if (bundle?.sex) setSex(bundle.sex);
        if (bundle?.weight_kg != null) setWeightKg(bundle.weight_kg);
        if (bundle?.goals?.length) setGoals(bundle.goals);
        // Hydrate conditions from the DB only. New users start with none -
        // never auto-assign clinical conditions the user did not report.
        if (bundle?.conditions?.length) {
          setConditions(bundle.conditions);
        }
      })
      .catch(() => {
        /* leave conditions empty on a fetch miss */
      });
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
      const patch = await importLabs(getUserRef());
      apply(patch);
      setBloodwork("done");
      setBloodworkConnected(true);
      try {
        localStorage.setItem(BLOOD_KEY, JSON.stringify({ labs: patch.labs ?? [], label: patch.source?.label }));
      } catch {
        /* storage full / disabled */
      }
    } catch (e) {
      setBloodwork("error");
      setError(e instanceof Error ? e.message : "Could not pull bloodwork.");
    }
  }, [apply]);

  // Actually use Junction: open the hosted Link flow so a real wearable provider
  // (Garmin / Oura / WHOOP / …) can be connected. Poll Junction for the linked
  // provider; once linked, close the popup and pull real summaries. Only the
  // metrics the provider hasn't synced yet are mock-filled.
  const pullWearable = useCallback(async () => {
    setError(null);
    setWearableState("working");
    try {
      // 1) a provider may already be linked → use real data straight away.
      let res = await importWearable(getUserRef());

      if (res.mocked) {
        // 2) open Junction Link in a new tab. We do NOT close it — the user
        //    needs time to log in to their provider (Garmin/Oura/…); they can
        //    close it themselves once it says "Success".
        try {
          const { link_url } = await importLink(getUserRef());
          window.open(link_url, "_blank", "noopener,noreferrer");
        } catch {
          /* link unavailable — keep the mock fallback below */
        }
        cancelled.current = false;
        // 3) poll for the provider to finish linking (~3min ceiling), then pull.
        for (let i = 0; i < 72; i++) {
          await sleep(POLL_INTERVAL_MS);
          if (cancelled.current) break;
          try {
            const r = await importProfile(getUserRef());
            if (r.connected) {
              // provider linked — pull; retry a few times while data backfills.
              res = await importWearable(getUserRef());
              for (let j = 0; j < 4 && res.mocked; j++) {
                await sleep(POLL_INTERVAL_MS);
                res = await importWearable(getUserRef());
              }
              break;
            }
          } catch {
            /* keep polling */
          }
        }
      }

      setWearableMetrics(res.metrics);
      setWearableMocked(res.mocked);
      setWearableState("done");
      setWearableConnected(true);
      try {
        localStorage.setItem(WEARABLE_KEY, JSON.stringify({ metrics: res.metrics, mocked: res.mocked }));
      } catch {
        /* storage full / disabled */
      }
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
    try {
      localStorage.removeItem(BLOOD_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const disconnectWearable = useCallback(() => {
    cancelled.current = true;
    setWearableConnected(false);
    setWearableMetrics(null);
    setWearableState("idle");
    setDevice("idle");
    setDeviceLabel(null);
    try {
      localStorage.removeItem(WEARABLE_KEY);
    } catch {
      /* ignore */
    }
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
