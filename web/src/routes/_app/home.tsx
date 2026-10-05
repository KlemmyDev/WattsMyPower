import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/features/home/components/HomePage";
import type { Range } from "~/features/home/components/UsageCard";

/** `range`: the period shown (today by the hour, or the last 7 or 30 days); 7 days when left out. */
type Search = { range?: Range };

export const Route = createFileRoute("/_app/home")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    range: s.range === "today" || s.range === "month" ? s.range : undefined,
  }),
  head: () => ({ meta: [{ title: "Home · WattsMyPower" }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const { range } = Route.useSearch();
  return <HomePage range={range ?? "week"} />;
}
