import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Dock } from "~/features/common/layout/components/Dock";
import { TopBar } from "~/features/common/layout/components/TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  // Keyed by section, so opening a page lets its sections rise into place (.page-rise), while moving
  // within one (a settings tab, a day in History) leaves the rest of the page where it is. It follows
  // the page being shown (resolvedLocation), not the address: while the next page loads, the one on
  // screen stays put rather than starting its entrance again.
  const section = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname.split("/")[1] });
  return (
    <div className="min-h-screen bg-canvas">
      {/* The sticky header carries the space above and below it (pt-5/pb-3), so the page starts where it did. */}
      <TopBar />
      <main
        key={section}
        className="page-rise mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-8 pt-9 pb-[136px] max-sm:px-4 max-sm:pt-6"
      >
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
