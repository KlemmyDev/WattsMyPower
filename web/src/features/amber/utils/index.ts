import type { AmberPrices, AmberStatus, PriceInterval } from "~/features/amber/types";
import { centsShort, minus } from "~/features/common/formatting/utils/number";

/** A $/kWh price in cents, with a true minus sign: "23.4c", "−2.1c". */
export function priceLabel(rate: number) {
  const shown = centsShort(Math.abs(rate));
  return `${minus(rate, shown)}${shown}`;
}

/** The interval covering a moment, if there's a price for it. */
export function intervalAt(list: PriceInterval[], ts: number): PriceInterval | null {
  return list.find((p) => p.start <= ts && ts < p.end) ?? null;
}

/** The time-weighted average price over [start, end), from the intervals that cover it (null if none do). */
export function averageOver(list: PriceInterval[], start: number, end: number): number | null {
  let sum = 0;
  let span = 0;
  for (const p of list) {
    const s = Math.max(start, p.start);
    const e = Math.min(end, p.end);
    if (e > s) {
      sum += p.rate * (e - s);
      span += e - s;
    }
  }
  return span ? sum / span : null;
}

export type Slot = { start: number; end: number; buy: number | null; sell: number | null; forecast: boolean };

/** Prices in slots of `step` seconds from `from` (aligned to the step), averaged when Amber's intervals are shorter. */
export function slots(p: AmberPrices, from: number, count: number, step: number): Slot[] {
  const first = Math.floor(from / step) * step;
  return Array.from({ length: count }, (_, k) => {
    const start = first + k * step;
    const end = start + step;
    return {
      start,
      end,
      buy: averageOver(p.general, start, end),
      sell: averageOver(p.feed_in, start, end),
      forecast: p.general.some((x) => x.start < end && x.end > start && !x.actual),
    };
  });
}

/** The cheapest and dearest half hour to buy in the next `hours` hours. */
export function extremes(p: AmberPrices, now: number, hours: number): { low: Slot; high: Slot } | null {
  const priced = slots(p, now, hours * 2, 1800).filter((s) => s.buy != null && s.end > now);
  if (!priced.length) return null;
  const by = (better: (a: number, b: number) => boolean) =>
    priced.reduce((a, s) => (better(s.buy as number, a.buy as number) ? s : a));
  return { low: by((a, b) => a < b), high: by((a, b) => a > b) };
}

/** "Prices since 2 Mar 2025" etc.: how far back stored prices go, as words. */
export function syncLine(s: AmberStatus, dayMonthYear: (ts: number) => string): string {
  if (!s.prices_from) return s.backfilling ? "Fetching prices…" : "No prices yet.";
  const from = `Prices from ${dayMonthYear(s.prices_from)}`;
  return s.backfilling ? `${from}, still fetching older days` : from;
}
