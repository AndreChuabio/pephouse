import { Icon } from "@iconify/react";

type Simulation2HeaderProps = {
  onRun: () => void;
  running?: boolean;
};

export function Simulation2Header({ onRun, running }: Simulation2HeaderProps) {
  return (
    <header className="h-14 border-b border-zinc-800 bg-[#0A0A0A] flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 uppercase tracking-widest font-medium">Simulation Builder</span>
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
