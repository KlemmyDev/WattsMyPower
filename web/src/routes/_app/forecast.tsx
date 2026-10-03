import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Forecast page grew into the Plan page: old links and bookmarks go there. */
export const Route = createFileRoute("/_app/forecast")({
  beforeLoad: () => {
    throw redirect({ to: "/plan", replace: true });
  },
});
