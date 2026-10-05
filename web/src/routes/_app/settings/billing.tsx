import { createFileRoute, redirect } from "@tanstack/react-router";

/** The billing period and smart meter data moved into Settings → Bills; old links land there. */
export const Route = createFileRoute("/_app/settings/billing")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/bills", hash: "period", replace: true });
  },
});
