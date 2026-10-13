import { createFileRoute } from "@tanstack/react-router";
import { SolarReadingsPage } from "~/features/solar/components/sections/ReadingsPage";

export const Route = createFileRoute("/_app/solar_/readings")({
  head: () => ({ meta: [{ title: "Readings · Solar · WattsMyPower" }] }),
  component: SolarReadingsPage,
});
