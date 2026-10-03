import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Insights page became Health: keep old links and bookmarks working. */
export const Route = createFileRoute("/_app/insights")({
  beforeLoad: () => {
    throw redirect({ to: "/health", replace: true });
  },
});
