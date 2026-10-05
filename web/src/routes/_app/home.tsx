import { createFileRoute } from "@tanstack/react-router";
import { STORE_HOME_RANGE, store } from "~/features/common/storage/utils";
import { HomePage } from "~/features/home/components/HomePage";
import type { Range } from "~/features/home/components/UsageCard";

const isRange = (v: unknown): v is Range => v === "today" || v === "week" || v === "month";

/** `range`: the period shown (today by the hour, or the last 7 or 30 days). Left out, it's the one last chosen in this
 * browser, else 7 days. */
type Search = { range?: Range };

export const Route = createFileRoute("/_app/home")({
  validateSearch: (s: Record<string, unknown>): Search => ({ range: isRange(s.range) ? s.range : undefined }),
  head: () => ({ meta: [{ title: "Home · WattsMyPower" }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const { range } = Route.useSearch();
  const remembered = store.get(STORE_HOME_RANGE);
  return <HomePage range={range ?? (isRange(remembered) ? remembered : "week")} />;
}
