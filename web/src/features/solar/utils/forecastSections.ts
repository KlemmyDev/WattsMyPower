import { hhmm, listDays } from "~/features/common/formatting/utils/date";
import type { HistorySeries } from "~/features/common/readings/types";
import type { ForecastAccuracy, ForecastHour } from "~/features/common/weather/types";
import type { PerformanceDay, SolarInsights } from "~/features/solar/types";
import type { WeatherHour } from "~/features/weather/types";

/*
 * Pure helpers for the Solar section pages (Performance and Forecast): the sums behind their cards, kept out of the
 * components so the cards only draw.
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

// ---------------------------------------------------------------------------------------------- forecast's record

export type MissDay = { date: string; forecast: number; actual: number; miss: number | null };

/**
 * Each day's miss as a share of what was made: +0.2 is a forecast 20% too high, −0.1 a day that beat it by 10%. Left
 * out (null) on days that made next to nothing, where any share would be meaningless.
 */
export function missDays(acc: ForecastAccuracy | null | undefined): MissDay[] {
  return (acc?.days ?? []).map((d) => ({
    date: d.date,
    forecast: d.forecast_kwh,
    actual: d.actual_kwh,
    miss: d.actual_kwh >= 0.5 ? d.forecast_kwh / d.actual_kwh - 1 : null,
  }));
}

/**
 * The typical miss (kWh either way) over each run of `n` days, ending on each day from the `n`th on. Falling over the
 * month means the forecast is getting closer.
 */
export function rollingMiss(acc: ForecastAccuracy | null | undefined, n = 7): { date: string; kwh: number }[] {
  const days = acc?.days ?? [];
  const out: { date: string; kwh: number }[] = [];
  for (let i = n - 1; i < days.length; i++) {
    const run = days.slice(i - n + 1, i + 1);
    out.push({ date: days[i].date, kwh: run.reduce((a, d) => a + Math.abs(d.forecast_kwh - d.actual_kwh), 0) / n });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- hour by hour

export type HourPair = { ts: number; forecast: number | null; made: number | null; done: boolean };

/**
 * Today hour by hour: what this morning's forecast expected in each hour (kWh) against what the panels made in it,
 * summed from the 5-minute readings. Made is left out for hours still to come and for hours with too few readings to
 * sum (under half of them). Only the daylight hours, from the first the forecast or the readings had any solar to the
 * last.
 */
export function todayByHour(hours: WeatherHour[], series: HistorySeries | undefined, now: number): HourPair[] {
  const t = series?.t ?? [];
  const w = series?.pv_power ?? [];
  const step = t.length > 1 ? t[1] - t[0] : 300;
  const all = hours.map((h) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < h.ts || t[i] >= h.ts + 3600) continue;
      const v = w[i];
      if (v != null) {
        sum += Math.max(0, v);
        n++;
      }
    }
    const done = h.ts + 3600 <= now;
    const enough = n >= (3600 / step) * (done ? 0.5 : 0.25);
    // The hour we're in counts what it's made so far, so its bar grows through the hour.
    const made = h.ts <= now && enough ? ((sum / n / 1000) * (Math.min(now, h.ts + 3600) - h.ts)) / 3600 : null;
    return { ts: h.ts, forecast: h.pv_forecast, made, done };
  });
  const lit = (p: HourPair) => (p.forecast ?? 0) > 0.02 || (p.made ?? 0) > 0.02;
  const first = all.findIndex(lit);
  const last = all.findLastIndex(lit);
  return first < 0 ? [] : all.slice(first, last + 1);
}

/** The forecast and what was made over the hours that are over, for "expected X by now, you made Y". */
export function soFar(pairs: HourPair[]): { forecast: number; made: number; hours: number } | null {
  const done = pairs.filter((p) => p.done && p.forecast != null && p.made != null);
  if (!done.length) return null;
  return {
    forecast: done.reduce((a, p) => a + p.forecast!, 0),
    made: done.reduce((a, p) => a + p.made!, 0),
    hours: done.length,
  };
}

/**
 * A day's best hours: the run of hours around its peak making at least three quarters of the peak, as "10:00–14:00".
 * Null for a day the forecast expects next to nothing from.
 */
export function bestHours(hours: Pick<ForecastHour, "ts" | "pv_kw">[]): string | null {
  if (!hours.length) return null;
  let peak = 0;
  for (let i = 1; i < hours.length; i++) if (hours[i].pv_kw > hours[peak].pv_kw) peak = i;
  const top = hours[peak].pv_kw;
  if (top < 0.1) return null;
  let a = peak;
  let b = peak;
  while (a > 0 && hours[a - 1].pv_kw >= 0.75 * top) a--;
  while (b < hours.length - 1 && hours[b + 1].pv_kw >= 0.75 * top) b++;
  return `${hhmm(hours[a].ts)}–${hhmm(hours[b].ts + 3600)}`;
}

/** A day's forecast hours, from its local midnight to the next. */
export const hoursOf = <H extends { ts: number }>(hours: H[], start: number, end: number) =>
  hours.filter((h) => h.ts >= start && h.ts < end);
