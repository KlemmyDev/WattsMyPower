import { createFileRoute } from "@tanstack/react-router";
import { STORE_HOME_RANGE, store } from "~/features/common/storage/utils";
import { HomePage } from "~/features/home/components/HomePage";
import { dateKey, fromDateKey, midnight, nowS } from "~/features/common/time/utils";
import type { Range } from "~/features/home/components/UsageCard";

const isRange = (v: unknown): v is Range => v === "today" || v === "week" || v === "month";

/** `range`: the period shown (a day by the hour, or the last 7 or 30 days). Left out, it's the one last chosen in this
 * browser, else 7 days. `day`: the day shown by the hour, YYYY-MM-DD, when it's an earlier one than today. */
type Search = { range?: Range; day?: string };

/** A real date before today, or nothing (today is the default, and later days haven't happened). */
function pastDay(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const ts = fromDateKey(v);
  return dateKey(ts) === v && ts < midnight(nowS()) ? v : undefined;
}

export const Route = createFileRoute("/_app/home")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    range: isRange(s.range) ? s.range : undefined,
    day: pastDay(s.day),
  }),
  head: () => ({ meta: [{ title: "Home · WattsMyPower" }] }),
  component: HomeRoute,
});

function HomeRoute() {
  const { range, day } = Route.useSearch();
  const remembered = store.get(STORE_HOME_RANGE);
  // A day asked for opens the day view, whatever was last chosen.
  const shown = day ? "today" : (range ?? (isRange(remembered) ? remembered : "week"));
  return <HomePage range={shown} day={day && shown === "today" ? fromDateKey(day) : undefined} />;
}
