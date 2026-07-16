import { Icon } from "@iconify/react";
import type { ReactNode } from "react";

type PanelHeaderProps = {
  icon: string;
  title: string;
  action?: ReactNode;
};

export function PanelHeader({ icon, title, action }: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-display text-sm font-medium text-ink flex items-center gap-2.5 tracking-tight">
        <Icon icon={icon} className="text-signal w-4 h-4" />
        {title}
      </h2>
      {action}
    </div>
  );
}
