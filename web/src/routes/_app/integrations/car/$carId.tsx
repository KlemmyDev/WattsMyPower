import { createFileRoute, redirect } from "@tanstack/react-router";

/** A car's details moved under Tesla: old links (and the Overview's from before) land there. */
export const Route = createFileRoute("/_app/integrations/car/$carId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/integrations/tesla/car/$carId", params: { carId: params.carId }, replace: true });
  },
});
