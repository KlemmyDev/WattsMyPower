import { createFileRoute } from "@tanstack/react-router";
import { SolarBatterySettings } from "~/features/settings/components/SolarBatterySettings";

export const Route = createFileRoute("/_app/system/solar-battery")({
  head: () => ({ meta: [{ title: "Solar and battery · System · WattsMyPower" }] }),
  component: SolarBatterySettings,
});
