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
      <h2 className="text-sm font-medium text-white flex items-center gap-2">
        <Icon icon={icon} className="text-zinc-400" />
        {title}
      </h2>
      {action}
    </div>
  );
}
