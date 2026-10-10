import { createFileRoute, redirect } from "@tanstack/react-router";

/** System's pages are Settings' now: "/system/house" → "/settings/house". */
export const Route = createFileRoute("/_app/system/$")({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/settings/${params._splat ?? ""}`, replace: true });
  },
});
