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
        "bg-surface/70 border border-line rounded-[var(--radius-card)] backdrop-blur-sm",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.02)_inset,0_10px_30px_-16px_rgba(0,0,0,0.7)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
