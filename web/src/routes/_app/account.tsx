import { createFileRoute, redirect } from "@tanstack/react-router";

/** Account is one of Settings' pages now: old links land on it there. */
export const Route = createFileRoute("/_app/account")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/account", replace: true });
  },
});
