import { listDays } from "~/features/common/formatting/utils/date";
import type { PerformanceDay, SolarInsights } from "~/features/solar/types";

/*
 * Pure helpers for how the panels are doing against the weather: the sums behind the Solar page's performance figures,
 * kept out of the components so the cards only draw.
 */

/** Below this share of what the weather allowed, a clear day counts as low (the Solar page's "more than 10% below"). */
export const HEALTHY = 0.9;

/** The mean of some numbers, or null with none. */
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);

/** A clear day more than 10% under what the weather allowed. */
export const isLow = (d: PerformanceDay) => d.clear && d.ratio != null && d.ratio < HEALTHY;

export type Tone = "warn" | "ok" | "wait";

/**
 * How the last 30 days went against the weather, in a line: still learning, fine on every clear day, or which clear
 * days fell short (and what usually does that).
 */
export function performanceNote(
  P: SolarInsights["performance"],
  located: boolean | undefined,
): { tone: Tone; note: string } {
  if (!P && located === false)
    return {
      tone: "wait",
      note: "Set your location (Manage → Integrations → Weather) to compare what the panels made with what the weather allowed.",
    };
  if (!P)
    return {
      tone: "wait",
      note: "Past weather isn't available right now, so solar can't be compared with what the weather allowed.",
    };
  if (P.fitted_hours < 24 || !P.days.some((d) => d.ratio != null))
    return {
      tone: "wait",
      note: "Learning what your panels should make for the weather. This needs a few days of daylight readings.",
    };
  const lows = P.days.filter(isLow).map((d) => d.date);
  if (!lows.length) return { tone: "ok", note: "Within 10% of expected on every clear day with readings." };
  const when =
    lows.length <= 4
      ? `on ${listDays(lows)}, ${lows.length === 1 ? "a clear day" : "all clear days"}`
      : `on ${lows.length} clear days in the last 30, most recently ${listDays(lows.slice(-1))}`;
  return {
    tone: "warn",
    note: `More than 10% below expected ${when}. Dust, bird droppings or new shade are the usual causes. Worth a look if it keeps happening.`,
  };
}

/** The 30 days' average share of what the weather allowed, over the days with enough readings to judge. */
export function averageRatio(days: PerformanceDay[]): number | null {
  return mean(days.flatMap((d) => (d.ratio != null ? [d.ratio] : [])));
}

/** The day after `date` (YYYY-MM-DD), as YYYY-MM-DD: the first day a rain's wash shows in. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
