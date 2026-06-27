import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="h-screen w-full flex overflow-hidden antialiased selection:bg-zinc-800 selection:text-white">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0a0c] relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />
        {children}
      </main>
    </div>
  );
}
