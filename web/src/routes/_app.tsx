import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Fragment } from "react";
import { AppShell } from "~/features/common/layout/components/AppShell";
import { sessionQuery } from "~/features/auth/api";
import { useSignOutOnExpiry } from "~/features/auth/hooks/useSignOutOnExpiry";
import { useDisplay } from "~/features/common/display/hooks";
import { LiveProvider } from "~/features/common/live/components/LiveProvider";
import { useSiteZone } from "~/features/common/time/hooks";
import { onboardingQuery } from "~/features/onboarding/api";

/**
 * Every dashboard page: signed in only, with the top bar, live updates, and the mini power-flow dock.
 * A new install goes to the set-up guide first, until it's finished or put off.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session.authenticated) throw redirect({ to: "/login", search: { redirect: location.href }, replace: true });
    // If the guide's progress can't be read, open the dashboard rather than risk a loop.
    const onboarding = await context.queryClient.ensureQueryData(onboardingQuery).catch(() => null);
    if (onboarding?.show) throw redirect({ to: "/welcome", replace: true });
  },
  component: AppLayout,
});

function AppLayout() {
  useSignOutOnExpiry();
  // Times are formatted as they're drawn: switching the clock, or hearing the site's time zone (when it isn't the
  // one remembered from last time), draws the page afresh, charts and all (the top bar and dock draw again with it).
  const [{ clock }] = useDisplay();
  const zone = useSiteZone();
  return (
    <LiveProvider>
      <AppShell>
        <Fragment key={`${clock} ${zone}`}>
          <Outlet />
        </Fragment>
      </AppShell>
    </LiveProvider>
  );
}
