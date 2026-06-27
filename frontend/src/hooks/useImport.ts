import { useCallback, useEffect, useRef, useState } from "react";
import { importLabs, importLink, importProfile } from "../lib/api";
import { getUserRef } from "../lib/userRef";
import type { ImportPatch, LabValue } from "../types/simulation";

export type FlowState = "idle" | "working" | "done" | "error";

const POLL_INTERVAL_MS = 2_500;
const MAX_POLLS = 16;

/** Junction import state for the Digital Twin page: connect a wearable + pull bloodwork. */
export function useImport() {
  const [device, setDevice] = useState<FlowState>("idle");
  const [bloodwork, setBloodwork] = useState<FlowState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Accumulated patient picture from whatever has been imported so far.
  const [age, setAge] = useState<number | null>(null);
  const [sex, setSex] = useState<"M" | "F" | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [labs, setLabs] = useState<LabValue[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [bloodworkLabel, setBloodworkLabel] = useState<string | null>(null);

  const cancelled = useRef(false);
  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const apply = useCallback((p: ImportPatch) => {
    if (p.age != null) setAge(p.age);
    if (p.sex) setSex(p.sex);
    if (p.weightKg != null) setWeightKg(p.weightKg);
    if (p.labs && p.labs.length) setLabs(p.labs);
    if (p.conditions && p.conditions.length) setConditions(p.conditions);
    if (p.source.kind === "device") setDeviceLabel(p.source.label);
    if (p.source.kind === "bloodwork") setBloodworkLabel(p.source.label);
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const checkProfile = useCallback(async (): Promise<boolean> => {
    const { connected, patch } = await importProfile(getUserRef());
    if (connected && patch) {
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

  const hasData = labs.length > 0 || age != null || weightKg != null;

  return {
    device,
    bloodwork,
    error,
    age,
    sex,
    weightKg,
    labs,
    conditions,
    deviceLabel,
    bloodworkLabel,
    hasData,
    connectDevice,
    recheckDevice,
    pullBloodwork,
  };
}
