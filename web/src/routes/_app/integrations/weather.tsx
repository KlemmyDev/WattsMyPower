import { createFileRoute } from "@tanstack/react-router";
import { WeatherSettings } from "~/features/weather/components/WeatherSettings";

export const Route = createFileRoute("/_app/integrations/weather")({
  head: () => ({ meta: [{ title: "Weather · Integrations · WattsMyPower" }] }),
  component: WeatherSettings,
});
