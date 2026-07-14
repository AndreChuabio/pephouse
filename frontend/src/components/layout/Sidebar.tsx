import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Link, useLocation } from "react-router-dom";
import { PLATFORM_NAV, SETTINGS_NAV } from "../../config/navigation";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/AuthProvider";
import type { NavItem } from "../../types/navigation";

type SidebarNavItemProps = {
  item: NavItem;
  isActive: boolean;
};

function SidebarNavItem({ item, isActive }: SidebarNavItemProps) {
  const className = cn(
    "group relative flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors",
    isActive
      ? "bg-surface-2 text-ink font-medium"
      : "text-muted hover:text-ink hover:bg-surface/60 font-normal",
  );
  // The active row carries a warm signal spine on its left edge — the one place
  // the brand color marks "you are here".
  const marker = isActive ? (
    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-signal" />
  ) : null;

  if (item.to.startsWith("/")) {
    return (
      <Link to={item.to} className={className}>
        {marker}
        <Icon icon={item.icon} className={cn("w-[18px] h-[18px]", isActive ? "text-signal" : "text-faint group-hover:text-muted")} />
        {item.label}
      </Link>
    );
  }

  return (
    <a href={item.to} className={className}>
      {marker}
      <Icon icon={item.icon} className="w-[18px] h-[18px] text-faint" />
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
      <p className={cn("eyebrow px-2.5 mb-3 mt-2", className)}>{title}</p>
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
  const { isAnonymous, signInWithGoogle, signOut } = useAuth();
  const [showAccount, setShowAccount] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const handleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      // On success the browser redirects to Google; authBusy stays set.
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setShowAccount(false);
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOut();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-out failed. Try again.");
    } finally {
      setAuthBusy(false);
    }
  };

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
    <aside className="w-64 border-r border-line bg-base/80 backdrop-blur-sm flex flex-col justify-between shrink-0 hidden md:flex h-full z-10">
      <div>
        <div className="h-16 flex items-center px-5 border-b border-line">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="pulse-signal absolute inline-flex h-2 w-2 rounded-full bg-signal" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
            </span>
            <span className="font-display font-semibold tracking-tight text-ink text-[15px] group-hover:text-signal transition-colors">
              PepHouse
            </span>
          </Link>
        </div>

        <nav className="p-3.5 space-y-1">
          <NavSection title="Platform" items={PLATFORM_NAV} pathname={pathname} />
        </nav>
      </div>

      <div ref={accountRef} className="p-3.5 border-t border-line relative">
        {showAccount && (
          <div className="absolute bottom-full left-3.5 right-3.5 mb-2 bg-surface-2 border border-line rounded-lg shadow-xl p-2 space-y-1">
            {SETTINGS_NAV.map((item) => (
              <SidebarNavItem
                key={item.label}
                item={item}
                isActive={item.to.startsWith("/") && pathname === item.to}
              />
            ))}
            {!isAnonymous && (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={authBusy}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-surface/60 transition-colors disabled:opacity-50"
              >
                <Icon icon="solar:logout-3-linear" className="w-[18px] h-[18px] text-faint" />
                Sign out
              </button>
            )}
          </div>
        )}
        {isAnonymous ? (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={authBusy}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg border border-line hover:border-line-bright hover:bg-surface/60 transition-colors text-left disabled:opacity-50"
          >
            <div className="h-8 w-8 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
              <Icon icon="solar:login-3-linear" className="w-[18px] h-[18px] text-signal" />
            </div>
            <span className="text-sm font-medium text-ink truncate flex-1">
              {authBusy ? "Redirecting" : "Sign in with Google"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowAccount(true)}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-surface/60 transition-colors text-left"
            aria-expanded={showAccount}
          >
            <div className="h-8 w-8 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
              <Icon icon="solar:user-linear" className="w-[18px] h-[18px] text-ink" />
            </div>
            <span className="text-sm font-medium text-ink truncate flex-1">Account</span>
            <Icon icon="solar:alt-arrow-up-linear" className="text-faint shrink-0" />
          </button>
        )}
        {authError && (
          <p className="mt-2 px-1 text-[11px] leading-snug text-danger" role="alert">
            {authError}
          </p>
        )}
      </div>
    </aside>
  );
}
