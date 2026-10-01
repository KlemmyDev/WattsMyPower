import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "~/features/common/layout/components/AppShell";
import { sessionQuery } from "~/features/auth/api";
import { useSignOutOnExpiry } from "~/features/auth/hooks/useSignOutOnExpiry";
import { LiveProvider } from "~/features/common/live/components/LiveProvider";

/** Every dashboard page: signed in only, with the top bar, live updates, and the mini power-flow dock. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session.authenticated) throw redirect({ to: "/login", search: { redirect: location.href }, replace: true });
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
