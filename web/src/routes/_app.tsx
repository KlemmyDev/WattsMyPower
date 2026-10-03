import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "~/features/common/layout/components/AppShell";
import { sessionQuery } from "~/features/auth/api";
import { useSignOutOnExpiry } from "~/features/auth/hooks/useSignOutOnExpiry";
import { LiveProvider } from "~/features/common/live/components/LiveProvider";
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
  return (
    <LiveProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </LiveProvider>
  );
}
