import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";

const TABS = [
  { to: "/settings/system", label: "System" },
  { to: "/settings/tariffs", label: "Tariffs" },
  { to: "/settings/billing", label: "Billing" },
  { to: "/settings/integrations", label: "Integrations" },
  { to: "/settings/alerts", label: "Alerts" },
  { to: "/settings/account", label: "Account" },
] as const;

/** Settings: a tab row over the System, Tariffs, Billing, Integrations, Alerts and Account pages. */
export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = useRef<HTMLElement>(null);
  // Keep the current tab in view when the row is scrolled sideways (on a phone, Alerts and Account start off-screen).
  useEffect(() => {
    const row = tabs.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !tab) return;
    if (tab.offsetLeft < row.scrollLeft || tab.offsetLeft + tab.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
  }, [path]);

  return (
    <>
      <PageHeader title="Settings" sub="System details, rates, billing, connected services and alerts" />
      {/* On a phone the tabs don't all fit: the row scrolls sideways on its own, not the page. The baseline is
          an inset shadow rather than a border, so the current tab's underline sits on it without overflowing. */}
      <nav
        ref={tabs}
        aria-label="Settings"
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto overscroll-x-contain shadow-[inset_0_-1px_0_var(--color-line)] max-sm:gap-0 [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex-none border-b-2 border-transparent px-4 py-3 text-sm font-semibold whitespace-nowrap text-ink-muted no-underline hover:text-ink max-sm:px-3"
            activeProps={{ className: "border-ink! text-ink!" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
