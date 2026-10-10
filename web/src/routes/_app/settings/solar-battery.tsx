import { createFileRoute } from "@tanstack/react-router";
import { SolarBatterySettings } from "~/features/settings/components/SolarBatterySettings";

export const Route = createFileRoute("/_app/settings/solar-battery")({
  head: () => ({ meta: [{ title: "Solar and battery · Settings · WattsMyPower" }] }),
  component: SolarBatterySettings,
});
