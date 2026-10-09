import { createFileRoute, redirect } from "@tanstack/react-router";

/** The EV page was the Tesla page: old links land on it. */
export const Route = createFileRoute("/_app/tesla/")({
  beforeLoad: () => {
    throw redirect({ to: "/ev", replace: true });
  },
});
