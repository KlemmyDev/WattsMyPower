import { useRouterState } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { Dock } from "~/features/common/layout/components/Dock";
import { SectionPagesStrip } from "~/features/common/layout/components/SectionPagesStrip";
import { NavDrawer, SideNav } from "~/features/common/layout/components/SideNav";
import { TopBar } from "~/features/common/layout/components/TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  // Keyed by section, so opening a page lets its sections rise into place (.page-rise), while moving
  // within one (a settings tab, a day in History) leaves the rest of the page where it is. It follows
  // the page being shown (resolvedLocation), not the address: while the next page loads, the one on
  // screen stays put rather than starting its entrance again.
  const section = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname.split("/")[1] });
  const [menu, setMenu] = useState(false);
  const openMenu = useCallback(() => setMenu(true), []);
  const closeMenu = useCallback(() => setMenu(false), []);
  return (
    // --nav-w is what the side nav takes on the left: nothing on a phone (it's a menu there), the rail on a tablet,
    // and from xl the circuit. The page centres in what's left. The power flow is in the side nav, or on a phone the dock.
    <div className="min-h-screen bg-canvas [--nav-w:0px] md:[--nav-w:72px] xl:[--nav-w:236px]">
      {/* The sticky header carries the space above and below it, so the page starts where it did. */}
      <TopBar onMenu={openMenu} />
      <SideNav onMenu={openMenu} />
      <NavDrawer open={menu} onClose={closeMenu} />
      <div className="pl-(--nav-w)">
        <main
          key={section}
          className="page-rise mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-8 pt-9 pb-[136px] max-sm:px-4 max-sm:pt-6 md:pt-10 md:pb-16"
        >
          <SectionPagesStrip />
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
