import { createFileRoute, redirect } from "@tanstack/react-router";

/** Rates moved into Settings → Bills; old links land on them there. */
export const Route = createFileRoute("/_app/settings/tariffs")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/bills", hash: "rates", replace: true });
  },
});
