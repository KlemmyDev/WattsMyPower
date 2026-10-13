import { createFileRoute } from "@tanstack/react-router";
import { SolarForecastPage } from "~/features/solar/components/sections/ForecastPage";

export const Route = createFileRoute("/_app/solar_/forecast")({
  head: () => ({ meta: [{ title: "Forecast · Solar · WattsMyPower" }] }),
  component: SolarForecastPage,
});
