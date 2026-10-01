import { createFileRoute } from "@tanstack/react-router";
import { InsightsPage } from "~/features/insights/components/InsightsPage";

export const Route = createFileRoute("/_app/insights")({
  head: () => ({ meta: [{ title: "Insights · WattsMyPower" }] }),
  component: InsightsPage,
});
