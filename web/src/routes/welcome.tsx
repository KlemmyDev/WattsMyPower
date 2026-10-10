import { createFileRoute, redirect } from "@tanstack/react-router";
import { sessionQuery } from "~/features/auth/api";
import { useSignOutOnExpiry } from "~/features/auth/hooks/useSignOutOnExpiry";
import { LiveProvider } from "~/features/common/live/components/LiveProvider";
import { useSiteZone } from "~/features/common/time/hooks";
import { onboardingQuery } from "~/features/onboarding/api";
import { WelcomePage } from "~/features/onboarding/components/WelcomePage";
import type { StepId } from "~/features/onboarding/types";
import { isStep } from "~/features/onboarding/utils";

type Search = { step?: StepId };

/** The first-run set-up guide: signed in only, without the dashboard's top bar and dock. */
export const Route = createFileRoute("/welcome")({
  validateSearch: (s: Record<string, unknown>): Search => ({ step: isStep(s.step) ? s.step : undefined }),
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session.authenticated) throw redirect({ to: "/login", search: { redirect: location.href }, replace: true });
  },
  // The progress, to pick up where it was left. Without it, the guide starts at the beginning.
  loader: ({ context }) => context.queryClient.ensureQueryData(onboardingQuery).catch(() => null),
  head: () => ({ meta: [{ title: "Welcome · WattsMyPower" }] }),
  component: WelcomeRoute,
});

function WelcomeRoute() {
  useSignOutOnExpiry();
  useSiteZone();
  const { step } = Route.useSearch();
  return (
    <LiveProvider>
      <WelcomePage step={step} />
    </LiveProvider>
  );
}
