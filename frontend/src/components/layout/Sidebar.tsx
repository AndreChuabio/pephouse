import { useEffect, useRef, useState } from "react";
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
        <Icon icon={item.icon} className={cn("text-base", isActive ? "text-blue-400" : "text-zinc-400")} />
        {item.label}
      </Link>
    );
  }

  return (
    <a href={item.to} className={className}>
      <Icon icon={item.icon} className="text-base" />
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
  const [showAccount, setShowAccount] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAccount) return;
    const onClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccount(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showAccount]);

  return (
    <aside className="w-64 border-r border-zinc-800/60 bg-zinc-950 flex flex-col justify-between shrink-0 hidden md:flex h-full z-10">
      <div>
        <div className="h-16 flex items-center px-6 border-b border-zinc-800/60">
          <div className="flex items-center text-white font-medium tracking-tighter uppercase text-sm">
            PEPHOUSE
          </div>
        </div>

        <nav className="p-4 space-y-1">
          <NavSection title="Platform" items={PLATFORM_NAV} pathname={pathname} />
        </nav>
      </div>

      <div ref={accountRef} className="p-4 border-t border-zinc-800/60 relative">
        {showAccount && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-zinc-950 border border-zinc-800 rounded-md shadow-xl p-2 space-y-1">
            {SETTINGS_NAV.map((item) => (
              <SidebarNavItem
                key={item.label}
                item={item}
                isActive={item.to.startsWith("/") && pathname === item.to}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowAccount(true)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-zinc-900 transition-colors text-left"
          aria-expanded={showAccount}
        >
          <div className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-medium text-white shrink-0">
            KN
          </div>
          <span className="text-sm font-medium text-white truncate flex-1">Kien</span>
          <Icon icon="solar:alt-arrow-up-linear" className="text-zinc-500 shrink-0" />
        </button>
      </div>
    </aside>
  );
}
