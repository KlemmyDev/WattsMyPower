import type { ReactNode } from "react";
import { Dock } from "~/features/common/layout/components/Dock";
import { TopBar } from "~/features/common/layout/components/TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TopBar />
      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-8 pt-12 pb-[120px] max-sm:px-4 max-sm:pt-8">
        {children}
      </main>
      <Dock />
    </div>
  );
}

/** Vertical stack for a page's sections. */
export function PageBody({ children, className = "gap-5" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col ${className}`}>{children}</div>;
}
