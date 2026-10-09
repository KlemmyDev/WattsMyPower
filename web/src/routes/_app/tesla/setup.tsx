import { createFileRoute, redirect } from "@tanstack/react-router";

/** Connecting an EV was connecting a Tesla: old links land on it. */
export const Route = createFileRoute("/_app/tesla/setup")({
  beforeLoad: () => {
    throw redirect({ to: "/ev/setup", replace: true });
  },
});
