import { createFileRoute } from "@tanstack/react-router";
import { SolarStringsPage } from "~/features/solar/components/sections/StringsPage";

export const Route = createFileRoute("/_app/solar_/strings")({
  head: () => ({ meta: [{ title: "Strings and inverters · Solar · WattsMyPower" }] }),
  component: SolarStringsPage,
});
