import type { Basis, BillSpan } from "~/features/bills/types";
import { dayMonth, monthShort, parseYmd } from "~/features/common/formatting/utils/date";
import { dollars, money } from "~/features/common/formatting/utils/number";
import { fromDateKey, partsOf, siteTime } from "~/features/common/time/utils";

/** A bill in whole dollars, with credits saying so: "$412", "$38 credit". */
export const billAmount = (v: number) => (v < 0 ? `${dollars(-v)} credit` : dollars(v));
/** A running total to the cent, with credits saying so: "$41.20", "$3.80 credit". */
export const billCents = (v: number) => (v < 0 ? `${money(-v)} credit` : money(v));

/** "1 Sep" from "2026-09-01". */
export const ymdLabel = (s: string) => dayMonth(fromDateKey(s));

/** "1 Sep to 30 Nov". */
export const spanLabel = (p: BillSpan) => `${ymdLabel(p.start)} to ${ymdLabel(p.end)}`;

/** A bill's label on a chart axis: "Sep" for monthly bills, "Sep–Nov" for longer ones. */
export const spanAxis = (p: BillSpan, months: number) => {
  const s = monthShort.format(parseYmd(p.start));
  return months === 1 ? s : `${s}–${monthShort.format(parseYmd(p.end))}`;
};

/** A likely range either side of an estimated bill. */
export const billSpread = (v: number) => Math.max(10, Math.abs(v) * 0.12);

/** Where estimates came from, as a sentence. */
export function basisNote(basis: Basis): string {
  if (basis === "last_year") return "Estimated from your usage in the same months last year, at your current rates";
  if (basis === "mixed")
    return "Estimated from the same months last year where there's data, otherwise your last 30 days, at your current rates";
  return "Estimated from your average day over the last 30 days, at your current rates";
}

/** Cents per kWh, rounded: "24c", "−3c". */
export const centsPerKwh = (v: number) => `${v < 0 ? "−" : ""}${Math.round(Math.abs(v) * 100)}c`;

/**
 * The first day of the billing period `day` falls in: periods of `months` months starting on
 * `startDay`, in step with `anchor` (a month, 1-12, a bill starts in), at its midnight. Matches the server.
 */
export function periodStart(ts: number, months: number, startDay: number, anchor: number): number {
  const day = partsOf(ts);
  let m = day.month - (day.day < startDay ? 1 : 0);
  while ((((m - anchor) % months) + months) % months) m--;
  return siteTime(day.year, m, startDay);
}

/** Vertical layout for bars that can go below zero, as percentages of the plot height. */
export function barScale(values: number[], top = 2, bottom = 2) {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / span) * (100 - top - bottom);
  const zero = y(0);
  return {
    zero,
    y,
    bar: (v: number) => ({ top: Math.min(y(v), zero), height: Math.max(0.8, Math.abs(y(v) - zero)) }),
  };
}
