import { createFileRoute } from "@tanstack/react-router";
import { PlanPage } from "~/features/plan/components/PlanPage";

/** `day`: which of the three days is open (0 today, 1 tomorrow, 2 the day after). */
type Search = { day?: number };

export const Route = createFileRoute("/_app/plan")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const day = Number(s.day);
    return { day: Number.isInteger(day) && day >= 0 && day <= 2 ? day : undefined };
  },
  head: () => ({ meta: [{ title: "Plan · WattsMyPower" }] }),
  component: PlanRoute,
});

function PlanRoute() {
  const { day } = Route.useSearch();
  return <PlanPage day={day} />;
}
