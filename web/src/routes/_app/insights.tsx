import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Insights page became Health, whose battery figures moved to Battery: keep old links and bookmarks working. */
export const Route = createFileRoute("/_app/insights")({
  beforeLoad: () => {
    throw redirect({ to: "/battery", replace: true });
  },
});
