import { dayMonth, parseYmd } from "~/features/common/formatting/utils/date";
import { intAU, plural } from "~/features/common/formatting/utils/number";

/** How often a channel reads: "half-hourly", "five-minute", "15-minute". */
export const intervalName = (minutes: number) =>
  minutes === 30 ? "half-hourly" : minutes === 5 ? "five-minute" : `${minutes}-minute`;

/** "1 Jul to 30 Sep 2026", or "28 Dec 2025 to 3 Jan 2026" across a new year. */
export function dateSpan(first: Date, last: Date): string {
  const label = (d: Date) => dayMonth(d.getTime() / 1000);
  if (first.toDateString() === last.toDateString()) return `${label(first)} ${first.getFullYear()}`;
  return first.getFullYear() === last.getFullYear()
    ? `${label(first)} to ${label(last)} ${last.getFullYear()}`
    : `${label(first)} ${first.getFullYear()} to ${label(last)} ${last.getFullYear()}`;
}

export const ymdSpan = (first: string, last: string) => dateSpan(parseYmd(first), parseYmd(last));

/** How the dashboard's figure compares with the meter's: "4% less than your meter", "within 2% of your meter". */
export function versusMeter(dashboard: number, meter: number): string {
  if (meter <= 0) return dashboard <= 0 ? "the same as your meter" : "your meter counted none";
  const share = ((dashboard - meter) / meter) * 100;
  if (Math.abs(share) < 2) return "within 2% of your meter";
  return `${Math.round(Math.abs(share))}% ${share > 0 ? "more" : "less"} than your meter`;
}

/** "120 readings" with thousands separators. */
export const readings = (n: number) => `${intAU(n)} ${plural(n, "reading")}`;
