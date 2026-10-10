import { dayMonth } from "~/features/common/formatting/utils/date";
import { fromDateKey, partsOf, sameDay } from "~/features/common/time/utils";
import { intAU, plural } from "~/features/common/formatting/utils/number";
import type { MeterChannel } from "~/features/meter/types";

/** How often a channel reads: "half-hourly", "five-minute", "15-minute". */
export const intervalName = (minutes: number) =>
  minutes === 30 ? "half-hourly" : minutes === 5 ? "five-minute" : `${minutes}-minute`;

/** "1 Jul to 30 Sep 2026", or "28 Dec 2025 to 3 Jan 2026" across a new year. */
export function dateSpan(first: number, last: number): string {
  const [a, b] = [partsOf(first).year, partsOf(last).year];
  if (sameDay(first, last)) return `${dayMonth(first)} ${a}`;
  return a === b ? `${dayMonth(first)} to ${dayMonth(last)} ${b}` : `${dayMonth(first)} ${a} to ${dayMonth(last)} ${b}`;
}

export const ymdSpan = (first: string, last: string) => dateSpan(fromDateKey(first), fromDateKey(last));

/** How the dashboard's figure compares with the meter's: "4% less than your meter", "within 2% of your meter". */
export function versusMeter(dashboard: number, meter: number): string {
  if (meter <= 0) return dashboard <= 0 ? "the same as your meter" : "your meter counted none";
  const share = ((dashboard - meter) / meter) * 100;
  if (Math.abs(share) < 2) return "within 2% of your meter";
  return `${Math.round(Math.abs(share))}% ${share > 0 ? "more" : "less"} than your meter`;
}

/**
 * A meter channel's name: "Grid import (E1)", "Grid export (B1)", or for channels kept out of grid figures,
 * "Controlled load (E2)" (a second import register is almost always controlled load) or "Other export (B2)".
 */
export const channelLabel = (c: Pick<MeterChannel, "suffix" | "direction" | "included">) =>
  `${
    c.included
      ? c.direction === "import"
        ? "Grid import"
        : "Grid export"
      : c.direction === "import"
        ? "Controlled load"
        : "Other export"
  } (${c.suffix})`;

/** "120 readings" with thousands separators. */
export const readings = (n: number) => `${intAU(n)} ${plural(n, "reading")}`;
