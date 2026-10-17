import { createFileRoute } from "@tanstack/react-router";
import { EvPage } from "~/features/ev/components/EvPage";

export const Route = createFileRoute("/_app/_live/ev/")({
  head: () => ({ meta: [{ title: "EV · WattsMyPower" }] }),
  component: EvPage,
});
