import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Health page's battery figures moved to Battery: keep old links and bookmarks working. */
export const Route = createFileRoute("/_app/health")({
  beforeLoad: () => {
    throw redirect({ to: "/battery", replace: true });
  },
});
