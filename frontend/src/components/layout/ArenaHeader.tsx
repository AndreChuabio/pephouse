import { Icon } from "@iconify/react";

type ArenaHeaderProps = {
  onRun: () => void;
  running?: boolean;
};

export function ArenaHeader({ onRun, running }: ArenaHeaderProps) {
  return (
    <header className="h-16 flex items-center justify-between px-8 border-b border-zinc-800/60 shrink-0 z-10 bg-zinc-950/80 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
          <Icon icon="solar:chart-2-linear" className="text-blue-400 text-xl" />
          Simulation [old]
        </h1>
        <div className="h-4 w-px bg-zinc-800" />
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Twin engine
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="text-xs font-medium text-zinc-400 hover:text-white transition-colors">
          Export Report
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-60 transition-colors text-sm font-medium px-4 py-1.5 rounded-md shadow-sm"
        >
          {running ? "Running simulation…" : "Run Simulation"}
        </button>
      </div>
    </header>
  );
}
