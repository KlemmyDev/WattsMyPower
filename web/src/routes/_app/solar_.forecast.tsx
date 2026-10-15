import { createFileRoute, redirect } from "@tanstack/react-router";

/** Solar's detail now sits on the Solar page itself: old links and bookmarks go there. */
export const Route = createFileRoute("/_app/solar_/forecast")({
  beforeLoad: () => {
    throw redirect({ to: "/solar", replace: true });
  },
});
