import { createFileRoute, redirect } from "@tanstack/react-router";

/** Bills & rates moved from Manage to a page of Bills': old links and bookmarks land on it there. */
export const Route = createFileRoute("/_app/rates")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/bills/rates${location.hash ? `#${location.hash}` : ""}`, replace: true });
  },
});
