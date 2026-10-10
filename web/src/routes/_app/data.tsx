import { createFileRoute, redirect } from "@tanstack/react-router";

/** Data is one of Settings' pages now: old links land on it there. */
export const Route = createFileRoute("/_app/data")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/data", replace: true });
  },
});
