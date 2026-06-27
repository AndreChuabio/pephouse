import { Icon } from "@iconify/react";
import type { AudienceMode } from "../../data/simulation2";
import { cn } from "../../lib/cn";

type Simulation2HeaderProps = {
  audience: AudienceMode;
  onAudienceChange: (mode: AudienceMode) => void;
  onRun: () => void;
  running?: boolean;
};

export function Simulation2Header({
  audience,
  onAudienceChange,
  onRun,
  running,
}: Simulation2HeaderProps) {
  return (
    <header className="h-14 border-b border-zinc-800 bg-[#0A0A0A] flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center gap-6">
        <div className="font-medium text-sm tracking-tighter uppercase text-zinc-100">Pephouse</div>
        <div className="h-4 w-px bg-zinc-800" />

        <div className="flex p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
          {(["clinician", "individual"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onAudienceChange(mode)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors",
                audience === mode
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-xs text-zinc-400 flex items-center gap-1.5">
          <Icon icon="solar:info-circle-linear" className="text-base" />
          Draft Simulation
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-60 transition-colors px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-2"
        >
          <Icon icon="solar:play-linear" className="text-sm" />
          {running ? "Running…" : "Run Execution"}
        </button>
      </div>
    </header>
  );
}
