import { createFileRoute, redirect } from "@tanstack/react-router";

/** Tesla was an integration of its own before Electric vehicles: old links and bookmarks land on Tesla's page under
 * it (/integrations/tesla/car/3 → /integrations/ev/tesla/car/3). */
export const Route = createFileRoute("/_app/integrations/tesla/$")({
  beforeLoad: ({ params, location }) => {
    const rest = params._splat ? `/${params._splat}` : "";
    throw redirect({
      href: `/integrations/ev/tesla${rest}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  },
});
