import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Dock } from "~/features/common/layout/components/Dock";
import { NAV_COLUMNS, SideNav } from "~/features/common/layout/components/SideNav";
import { TopBar } from "~/features/common/layout/components/TopBar";
import { useNavColumn } from "~/features/common/layout/hooks";
import { sectionOf } from "~/features/common/layout/utils";

export function AppShell({ children }: { children: ReactNode }) {
  // Keyed by section, so opening a page lets its sections rise into place (.page-rise), while moving
  // within one (a settings tab, a day in History) leaves the rest of the page where it is. It follows
  // the page being shown (resolvedLocation), not the address: while the next page loads, the one on
  // screen stays put rather than starting its entrance again.
  const section = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname.split("/")[1] });
  const current = useRouterState({ select: (s) => sectionOf(s.location.pathname) });
  const [open] = useNavColumn();
  const column = open && !!NAV_COLUMNS[current];
  return (
    // --nav-w is what the navigation takes on the left: nothing on a phone (it's the top bar there), the rail from
    // tablets up, and the rail and a section's column from 2xl. The page and the dock centre in what's left.
    <div
      data-nav-column={column ? "open" : "closed"}
      className="min-h-screen bg-canvas [--nav-w:0px] md:[--nav-w:72px] 2xl:data-[nav-column=open]:[--nav-w:320px]"
    >
      {/* The sticky header carries the space above and below it (pt-5/pb-3), so the page starts where it did. */}
      <TopBar />
      <SideNav />
      <div className="pl-(--nav-w) transition-[padding] duration-[450ms] ease-out-soft">
        <main
          key={section}
          className="page-rise mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-8 pt-9 pb-[136px] max-sm:px-4 max-sm:pt-6 md:pt-10"
        >
          {children}
        </main>
      </div>
      <Dock />
    </div>
  );
}

/** Vertical stack for a page's sections. */
export function PageBody({ children, className = "gap-5" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col ${className}`}>{children}</div>;
}
