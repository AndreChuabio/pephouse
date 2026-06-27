import { Icon } from "@iconify/react";
import type { useImport } from "../../hooks/useImport";
import { Panel } from "../ui/Panel";
import { PanelHeader } from "../ui/PanelHeader";

type ConnectDataCardProps = {
  imp: ReturnType<typeof useImport>;
};

/** Junction "Link Data" card: connect a wearable + pull a blood panel. */
export function ConnectDataCard({ imp }: ConnectDataCardProps) {
  const deviceWorking = imp.device === "working";
  const bloodWorking = imp.bloodwork === "working";

  return (
    <Panel className="p-5">
      <PanelHeader icon="solar:link-circle-linear" title="Link Your Data" />
      <p className="text-xs text-zinc-500 mb-4">
        Pull your real profile from a wearable or your latest lab panel via Junction.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={imp.connectDevice}
          disabled={deviceWorking}
          className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-4 text-sm text-zinc-200 hover:border-blue-700 hover:bg-blue-950/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <Icon
            icon={deviceWorking ? "svg-spinners:180-ring" : "solar:smart-watch-linear"}
            className="text-lg text-blue-400"
          />
          {imp.device === "done" ? "Wearable linked" : deviceWorking ? "Waiting…" : "Connect device"}
        </button>

        <button
          type="button"
          onClick={imp.pullBloodwork}
          disabled={bloodWorking}
          className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-4 text-sm text-zinc-200 hover:border-rose-700 hover:bg-rose-950/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <Icon
            icon={bloodWorking ? "svg-spinners:180-ring" : "solar:test-tube-linear"}
            className="text-lg text-rose-400"
          />
          {imp.bloodwork === "done" ? "Bloodwork pulled" : bloodWorking ? "Pulling…" : "Pull bloodwork"}
        </button>
      </div>

      {imp.device === "error" && (
        <button
          type="button"
          onClick={imp.recheckDevice}
          className="mt-3 w-full rounded-lg border border-blue-800/60 bg-blue-950/20 px-3 py-2 text-xs text-blue-300 hover:bg-blue-950/40"
        >
          I've connected — re-check
        </button>
      )}

      {imp.error && <p className="mt-3 text-xs text-amber-400">{imp.error}</p>}

      {(imp.deviceLabel || imp.bloodworkLabel) && (
        <div className="mt-4 space-y-2">
          {imp.deviceLabel && (
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <Icon icon="solar:check-circle-bold" />
              {imp.deviceLabel}
              {[
                imp.age != null ? `age ${imp.age}` : null,
                imp.sex ? (imp.sex === "M" ? "male" : "female") : null,
                imp.weightKg != null ? `${imp.weightKg} kg` : null,
              ].filter(Boolean).length > 0 && (
                <span className="text-zinc-500 font-mono">
                  ·{" "}
                  {[
                    imp.age != null ? `age ${imp.age}` : null,
                    imp.sex ? (imp.sex === "M" ? "male" : "female") : null,
                    imp.weightKg != null ? `${imp.weightKg} kg` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>
          )}
          {imp.bloodworkLabel && (
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <Icon icon="solar:check-circle-bold" />
              {imp.bloodworkLabel}
            </div>
          )}
          {imp.conditions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {imp.conditions.map((c) => (
                <span
                  key={c}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-950/50 border border-amber-800/60 text-amber-300"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
