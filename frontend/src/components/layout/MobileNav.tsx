import { useState } from "react";
import { Icon } from "@iconify/react";
import { Link, useLocation } from "react-router-dom";
import { PLATFORM_NAV } from "../../config/navigation";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/AuthProvider";

// Mobile navigation. The desktop sidebar is hidden below md, so on a phone these
// two bars are the whole chrome: a top bar for brand and account, and a bottom
// tab bar for moving between surfaces. Both are laid out in the AppShell flex
// column (not fixed), so content sizes naturally between them with no overlap.

export function MobileTopBar() {
  const { isAnonymous, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleSignIn = async (): Promise<void> => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      setBusy(false);
    }
  };

  return (
    <header className="md:hidden shrink-0 h-14 flex items-center justify-between px-4 border-b border-line bg-base/90 backdrop-blur-sm z-20">
      <Link to="/" className="flex items-center gap-2.5">
        <span className="relative flex h-2 w-2">
          <span className="pulse-signal absolute inline-flex h-2 w-2 rounded-full bg-signal" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
        </span>
        <span className="font-display font-semibold tracking-tight text-ink text-[15px]">
          PepHouse
        </span>
      </Link>
      {isAnonymous ? (
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-1.5 min-h-[44px] text-xs font-medium text-ink disabled:opacity-60"
        >
          <Icon
            icon={busy ? "svg-spinners:180-ring" : "logos:google-icon"}
            className="w-3.5 h-3.5"
          />
          {busy ? "..." : "Sign in"}
        </button>
      ) : (
        <Link
          to="/settings"
          className="h-10 w-10 rounded-lg bg-surface-2 border border-line flex items-center justify-center"
          aria-label="Account"
        >
          <Icon icon="solar:user-linear" className="w-[18px] h-[18px] text-ink" />
        </Link>
      )}
    </header>
  );
}

export function MobileBottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="md:hidden shrink-0 flex items-stretch border-t border-line bg-base/90 backdrop-blur-sm z-20 pb-[env(safe-area-inset-bottom)]">
      {PLATFORM_NAV.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            key={item.label}
            to={item.to}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
              active ? "text-signal" : "text-faint",
            )}
          >
            <Icon icon={item.icon} className="w-5 h-5" />
            <span className="tracking-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
