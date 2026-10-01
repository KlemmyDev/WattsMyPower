import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";

const TABS = [
  { to: "/settings/system", label: "System" },
  { to: "/settings/tariffs", label: "Tariffs" },
  { to: "/settings/integrations", label: "Integrations" },
  { to: "/settings/account", label: "Account" },
] as const;

/** Settings: a tab row over the System, Tariffs, Integrations and Account pages. */
export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <>
      <PageHeader title="Settings" sub="System details, rates, and connected services" />
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="-mb-px border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-ink-muted no-underline hover:text-ink"
            activeProps={{ className: "border-ink! text-ink!" }}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <Outlet />
    </>
  );
}
