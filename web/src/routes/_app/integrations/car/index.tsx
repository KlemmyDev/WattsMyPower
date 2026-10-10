import { createFileRoute, redirect } from "@tanstack/react-router";

/** Cars aren't added by hand any more (each connected Tesla brings its own): old links land on Tesla. */
export const Route = createFileRoute("/_app/integrations/car/")({
  beforeLoad: () => {
    throw redirect({ to: "/integrations/ev/tesla", replace: true });
  },
});
