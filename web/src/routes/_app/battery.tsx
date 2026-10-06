import { createFileRoute } from "@tanstack/react-router";
import { BatteryPage } from "~/features/battery/components/BatteryPage";

export const Route = createFileRoute("/_app/battery")({
  head: () => ({ meta: [{ title: "Battery · WattsMyPower" }] }),
  component: BatteryPage,
});
