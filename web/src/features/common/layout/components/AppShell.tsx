import type { ReactNode } from "react";
import { Dock } from "~/features/common/layout/components/Dock";
import { TopBar } from "~/features/common/layout/components/TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      {/* The sticky header carries the space above and below it (pt-5/pb-3), so the page starts where it did. */}
      <TopBar />
      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-8 pt-9 pb-[120px] max-sm:px-4 max-sm:pt-6">
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
