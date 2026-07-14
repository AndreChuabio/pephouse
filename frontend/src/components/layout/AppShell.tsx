import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="h-screen w-full flex overflow-hidden antialiased">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-base relative">
        {/* A single warm signal glow, top-center — the instrument's power light. */}
        <div className="absolute top-[-140px] left-1/2 -translate-x-1/2 w-[820px] h-[380px] bg-signal/5 rounded-full blur-[150px] pointer-events-none" />
        {children}
      </main>
    </div>
  );
}
