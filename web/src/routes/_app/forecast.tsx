import { createFileRoute } from "@tanstack/react-router";
import { ForecastPage } from "~/features/forecast/components/ForecastPage";

export const Route = createFileRoute("/_app/forecast")({
  head: () => ({ meta: [{ title: "Forecast · WattsMyPower" }] }),
  component: ForecastPage,
});
