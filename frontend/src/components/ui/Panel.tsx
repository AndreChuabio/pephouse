import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type PanelProps = {
  children: ReactNode;
  className?: string;
};

export function Panel({ children, className }: PanelProps) {
  return (
    <div
      className={cn(
        "bg-zinc-900/40 border border-zinc-800/80 rounded-xl shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
