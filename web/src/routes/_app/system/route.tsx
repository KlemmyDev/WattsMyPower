import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";

/** System: a list of settings, each opening a page of its own (your solar and battery, your house, updates…). */
export const Route = createFileRoute("/_app/system")({
  component: SystemLayout,
});

function SystemLayout() {
  const shown = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  return (
    <>
      <PageHeader title="System" sub="Your solar and battery system, the dashboard, and keeping it up to date" />
      {/* Each page's sections rise into place as it opens, as a page's do (keyed by the page shown). */}
      <div key={shown} className="page-rise flex min-w-0 flex-col gap-5">
        <Outlet />
      </div>
    </>
  );
}
