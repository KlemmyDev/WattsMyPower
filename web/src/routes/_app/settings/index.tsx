import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings became the pages under Manage: old links and bookmarks to it land on System. */
export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/system", replace: true });
  },
});
