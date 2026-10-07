import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { SETTINGS_SUB } from "~/features/settings/utils";

/**
 * Settings: the System, Bills, Integrations, Alerts, Database and Account pages. The side nav lists them (as a branch,
 * or in its column when collapsed), and narrower screens get them as a row of pills over the page.
 */
export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const shown = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  return (
    <>
      <PageHeader title="Settings" sub={SETTINGS_SUB} />
      {/* Each page's sections rise into place as it opens, as a page's do (keyed by the page shown). */}
      <div key={shown} className="page-rise flex min-w-0 flex-col gap-5">
        <Outlet />
      </div>
    </>
  );
}
