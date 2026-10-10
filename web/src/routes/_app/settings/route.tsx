import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

/**
 * Settings: a list of settings, each opening a page of its own (your solar and battery, your house, your account…).
 * Each page has its own title: Settings' on the list, and the page's (under a way back) on the others.
 */
export const Route = createFileRoute("/_app/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const shown = useRouterState({ select: (s) => (s.resolvedLocation ?? s.location).pathname });
  return (
    // Each page's sections rise into place as it opens, as a page's do (keyed by the page shown).
    <div key={shown} className="page-rise flex min-w-0 flex-col gap-5">
      <Outlet />
    </div>
  );
}
