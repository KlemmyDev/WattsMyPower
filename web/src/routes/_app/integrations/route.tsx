import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";

/** Integrations: the inverters, smart home, cars, and the grid, price and weather services, each with its own pages. */
export const Route = createFileRoute("/_app/integrations")({
  component: IntegrationsLayout,
});

function IntegrationsLayout() {
  const shown = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  return (
    <>
      <PageHeader title="Integrations" sub="Your inverters, smart home, cars, and the services the dashboard reads" />
      {/* Each page's sections rise into place as it opens, as a page's do (keyed by the page shown). */}
      <div key={shown} className="page-rise flex min-w-0 flex-col gap-5">
        <Outlet />
      </div>
    </>
  );
}
