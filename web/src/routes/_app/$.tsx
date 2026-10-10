import { createFileRoute } from "@tanstack/react-router";
import { NotFound } from "~/features/common/errors/components/ErrorPages";

/** Any address with no page of its own: "Page not found", in the dashboard's frame (signed in, as every page is). */
export const Route = createFileRoute("/_app/$")({
  head: () => ({ meta: [{ title: "Page not found · WattsMyPower" }] }),
  component: NotFound,
});
