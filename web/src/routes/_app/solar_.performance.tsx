import { createFileRoute } from "@tanstack/react-router";
import { SolarPerformancePage } from "~/features/solar/components/sections/PerformancePage";

export const Route = createFileRoute("/_app/solar_/performance")({
  head: () => ({ meta: [{ title: "Performance · Solar · WattsMyPower" }] }),
  component: SolarPerformancePage,
});
