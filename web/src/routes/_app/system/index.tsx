import { createFileRoute, redirect } from "@tanstack/react-router";

/** System was renamed Settings: old links land there (an old "#updates" on its Updates page). */
export const Route = createFileRoute("/_app/system/")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: location.hash === "updates" ? "/settings/updates" : "/settings", replace: true });
  },
});
