import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

/**
 * Integrations: the inverters, smart home, cars, and the grid, price and weather services, each with its own pages.
 * Each page has its own title, as Settings' do: Integrations' on the hub, and the page's (under a way back) below it.
 */
export const Route = createFileRoute("/_app/integrations")({
  component: IntegrationsLayout,
});

function IntegrationsLayout() {
  const shown = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  return (
    // Each page's sections rise into place as it opens, as a page's do (keyed by the page shown).
    <div key={shown} className="page-rise flex min-w-0 flex-col gap-5">
      <Outlet />
    </div>
  );
}
