import { createFileRoute } from "@tanstack/react-router";
import { SolarPage } from "~/features/solar/components/SolarPage";

export const Route = createFileRoute("/_app/_live/solar")({
  head: () => ({ meta: [{ title: "Solar · WattsMyPower" }] }),
  component: SolarPage,
});
