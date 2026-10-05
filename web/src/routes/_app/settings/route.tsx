import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useRef } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { usePillIndicator } from "~/features/common/layout/hooks";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

const TABS = [
  { to: "/settings/system", label: "System", icon: "home" },
  { to: "/settings/bills", label: "Bills", icon: "dollar" },
  { to: "/settings/integrations", label: "Integrations", icon: "plug" },
  { to: "/settings/alerts", label: "Alerts", icon: "bell" },
  { to: "/settings/database", label: "Database", icon: "database" },
  { to: "/settings/account", label: "Account", icon: "user" },
] as const satisfies readonly { to: string; label: string; icon: IconName }[];

/** Settings: a row of tabs over the System, Bills, Integrations, Alerts, Database and Account pages. */
export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const shown = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  const current: string | undefined = TABS.find((t) => path === t.to || path.startsWith(`${t.to}/`))?.to;
  const row = useRef<HTMLElement>(null);
  // The highlight slides under the current tab, as in the main navigation.
  const ind = usePillIndicator(row, [current]);

  return (
    <>
      <PageHeader title="Settings" sub="System details, bills and rates, connected services, alerts and your data" />
      {/* On a phone the tabs don't all fit: the row scrolls sideways on its own, not the page. */}
      <nav
        ref={row}
        aria-label="Settings"
        className="relative -mt-1 flex max-w-full [scrollbar-width:none] items-center gap-0.5 self-start overflow-x-auto overscroll-x-contain rounded-full border border-chip-line bg-chip p-1 [&::-webkit-scrollbar]:hidden"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-ink transition-[left,width,opacity] duration-[380ms,380ms,200ms] ease-spring"
          style={{ left: ind?.left ?? 4, width: ind?.width ?? 0, opacity: ind ? 1 : 0 }}
        />
        {TABS.map((t) => {
          const on = t.to === current;
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative z-1 flex h-9 flex-none items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap no-underline transition-[color,transform] duration-[260ms,160ms] active:scale-95 max-sm:px-3",
                on ? "text-ink-inverse hover:text-ink-inverse" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </Link>
          );
        })}
      </nav>
      {/* Each tab's sections rise into place as it opens, as a page's do (keyed by the tab shown). */}
      <div key={shown} className="page-rise flex min-w-0 flex-col gap-5">
        <Outlet />
      </div>
    </>
  );
}
