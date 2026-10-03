import { createFileRoute } from "@tanstack/react-router";
import { HealthPage } from "~/features/health/components/HealthPage";

export const Route = createFileRoute("/_app/health")({
  head: () => ({ meta: [{ title: "Health · WattsMyPower" }] }),
  component: HealthPage,
});
