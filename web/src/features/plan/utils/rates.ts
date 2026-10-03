import type { AmberPrices } from "~/features/amber/types";
import { averageOver } from "~/features/amber/utils";
import type { Tariff } from "~/features/common/tariffs/types";
import { bandAt, tariffNumber } from "~/features/common/tariffs/utils";

/** What grid power costs and feed-in earns over a span ($/kWh), and the name of what sets it. */
export type Rates = {
  buy: (start: number, end: number) => number;
  sell: (start: number, end: number) => number;
  /** "Peak", "Off-peak"; "Amber" while Amber's forecast covers the span; null on a single rate. */
  name: (start: number, end: number) => string | null;
};

/**
 * Prices for forecast hours. On Amber, each span at Amber's forecast prices, falling back to the
 * tariff's rates where there's no forecast yet; otherwise the time-of-use band or the single rate.
 */
export function ratesFor(t: Tariff, prices?: AmberPrices): Rates {
  const amber = t.type === "amber" ? prices : undefined;
  return {
    buy: (s, e) => (amber && averageOver(amber.general, s, e)) ?? bandAt(t, s).rate,
    sell: (s, e) => (amber && averageOver(amber.feed_in, s, e)) ?? tariffNumber(t.feed_in_rate),
    name: (s, e) =>
      amber && averageOver(amber.general, s, e) != null ? "Amber" : t.type === "tou" ? bandAt(t, s).name : null,
  };
}
