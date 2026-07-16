import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav, MobileTopBar } from "./MobileNav";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  // Column on mobile (top bar, content, bottom tab bar), row on desktop
  // (sidebar, content). The hidden bars take no space in the other layout, so
  // content is always sized correctly between whatever chrome is visible.
  return (
    <div className="h-screen w-full flex flex-col md:flex-row overflow-hidden antialiased">
      <Sidebar />
      <MobileTopBar />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden bg-base relative">
        {/* A single signal glow, top-center — the instrument's power light. */}
        <div className="absolute top-[-140px] left-1/2 -translate-x-1/2 w-[820px] max-w-full h-[380px] bg-signal/5 rounded-full blur-[150px] pointer-events-none" />
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
