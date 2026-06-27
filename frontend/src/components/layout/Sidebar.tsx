import { Icon } from "@iconify/react";
import { Link, useLocation } from "react-router-dom";
import { PLATFORM_NAV, SETTINGS_NAV } from "../../config/navigation";
import { cn } from "../../lib/cn";
import type { NavItem } from "../../types/navigation";

type SidebarNavItemProps = {
  item: NavItem;
  isActive: boolean;
};

function SidebarNavItem({ item, isActive }: SidebarNavItemProps) {
  const className = cn(
    "flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-colors",
    isActive
      ? "bg-zinc-800/50 text-white font-medium border border-zinc-700/50 shadow-sm"
      : "text-zinc-400 hover:text-white hover:bg-zinc-900 font-normal",
  );

  if (item.to.startsWith("/")) {
    return (
      <Link to={item.to} className={className}>
        <Icon
          icon={item.icon}
          className={cn("text-base shrink-0", isActive ? "text-blue-400" : "text-zinc-400")}
        />
        {item.label}
      </Link>
    );
  }

  return (
    <a href={item.to} className={className}>
      <Icon icon={item.icon} className="text-base shrink-0 text-zinc-400" />
      {item.label}
    </a>
  );
}

type NavSectionProps = {
  title: string;
  items: NavItem[];
  pathname: string;
  className?: string;
};

function NavSection({ title, items, pathname, className }: NavSectionProps) {
  return (
    <>
      <p
        className={cn(
          "px-2 text-xs font-medium text-zinc-500 uppercase tracking-widest mb-3 mt-2",
          className,
        )}
      >
        {title}
      </p>
      {items.map((item) => (
        <SidebarNavItem
          key={item.label}
          item={item}
          isActive={item.to.startsWith("/") && pathname === item.to}
        />
      ))}
    </>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="w-64 border-r border-zinc-800/60 bg-zinc-950 flex flex-col justify-between shrink-0 hidden md:flex h-full z-10">
      <div>
        <div className="h-16 flex items-center px-6 border-b border-zinc-800/60">
          <div className="flex items-center gap-2.5 text-white font-medium tracking-tighter uppercase text-sm">
            <Icon icon="solar:dna-linear" className="text-blue-500 text-lg" />
            PEPHOUSE
          </div>
        </div>

        <nav className="p-4 space-y-1">
          <NavSection title="Platform" items={PLATFORM_NAV} pathname={pathname} />
          <NavSection title="Settings" items={SETTINGS_NAV} pathname={pathname} className="mt-6" />
        </nav>
      </div>

      <div className="p-4 border-t border-zinc-800/60">
        <div className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-zinc-900 transition-colors cursor-pointer">
          <div className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-medium text-white">
            KN
          </div>
          <div className="flex flex-col flex-1 overflow-hidden">
            <span className="text-sm font-medium text-white truncate">Kien</span>
            <span className="text-xs text-zinc-500 truncate">Clinician Access</span>
          </div>
          <Icon icon="solar:alt-arrow-right-linear" className="text-zinc-500" />
        </div>
      </div>
    </aside>
  );
}
