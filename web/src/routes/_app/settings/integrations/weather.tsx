import { createFileRoute } from "@tanstack/react-router";
import { WeatherSettings } from "~/features/weather/components/WeatherSettings";

export const Route = createFileRoute("/_app/settings/integrations/weather")({
  head: () => ({ meta: [{ title: "Weather · Settings · WattsMyPower" }] }),
  component: WeatherSettings,
});
