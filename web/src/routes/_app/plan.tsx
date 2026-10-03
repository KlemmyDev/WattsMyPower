import { createFileRoute } from "@tanstack/react-router";
import { PlanPage } from "~/features/plan/components/PlanPage";

export const Route = createFileRoute("/_app/plan")({
  head: () => ({ meta: [{ title: "Plan · WattsMyPower" }] }),
  component: PlanPage,
});
