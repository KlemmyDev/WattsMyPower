import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Savings page became Bills: keep old links and bookmarks working. */
export const Route = createFileRoute("/_app/savings")({
  beforeLoad: () => {
    throw redirect({ to: "/bills", replace: true });
  },
});
