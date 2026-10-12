import { ON } from "~/features/common/energy/utils";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { sunDay } from "~/features/common/time/utils/sun";
import type { LinePoint } from "~/features/common/ui/components/TimeLine";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import type { SolarInsights } from "~/features/solar/types";
import type { WeatherDay } from "~/features/weather/types";

/** Where the system is, once it's been set (not the 0, 0 it starts at). */
export function place(s: SystemInfo | undefined): { lat: number; lon: number } | null {
  const lat = s?.latitude;
  const lon = s?.longitude;
  return lat != null && lon != null && (lat !== 0 || lon !== 0) ? { lat, lon } : null;
}

/** Solar now: what it's making, against the array and against what the forecast expected for this hour. */
export function solarNow(p: Snapshot | null, s: SystemInfo | undefined, f: Forecast | null | undefined, now: number) {
  const pv = p?.pv_power ?? null;
  const array = s?.pv_kw ?? null;
  const hour = f?.hours.find((h) => h.ts <= now && now < h.ts + 3600);
  const expected = hour ? hour.pv_kw * 1000 : null;
  return {
    pv,
    array,
    producing: pv != null && pv > ON,
    /** Of the array's size. */
    share: pv != null && array ? pv / (array * 1000) : null,
    /** What the forecast expected for this hour (W). */
    expected,
    /** Now against that: +0.1 is 10% more. Left out while it expected next to nothing. */
    vsExpected: pv != null && expected != null && expected > 50 ? pv / expected - 1 : null,
  };
}

/**
 * What the forecast expected for each hour of today, in W at the middle of the hour: the hours gone from the stored
 * day-ahead forecast, the hours to come from the forecast now.
 */
export function expectedToday(
  weather: WeatherDay | undefined,
  f: Forecast | null | undefined,
  now: number,
): LinePoint[] {
  const hour = Math.floor(now / 3600) * 3600;
  const gone = (weather?.hours ?? [])
    .filter((h) => h.ts < hour && h.pv_forecast != null)
    .map((h) => ({ t: h.ts + 1800, v: (h.pv_forecast ?? 0) * 1000 }));
  const ahead = (f?.hours ?? []).filter((h) => h.ts >= hour).map((h) => ({ t: h.ts + 1800, v: h.pv_kw * 1000 }));
  return [...gone, ...ahead].sort((a, b) => a.t - b.t);
}

/**
 * Today so far against the forecast: made, where it's heading by midnight (and the range it likely lands in), what
 * the forecast said this morning and the pace against it, the day's peak, and the day's sun.
 */
export function solarToday({
  p,
  s,
  f,
  acc,
  series,
  weather,
  now,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  series: HistorySeries | undefined;
  weather: WeatherDay | undefined;
  now: number;
}) {
  const made = p?.daily_pv ?? null;
  const rest = f?.days.find((d) => d.date === dateKey(now))?.pv_kwh ?? null;
  const heading = made != null && rest != null ? made + rest : null;
  const range = acc?.range;
  // This morning's forecast for the whole day, only when it was kept for most of the daylight hours: one missing
  // most of them (the forecast came on mid-morning) would make the day look far ahead.
  const daylight = (weather?.hours ?? []).filter((h) => h.is_day);
  const stored = daylight.filter((h) => h.pv_forecast != null).length;
  const planned =
    daylight.length && stored / daylight.length >= 0.8 ? (weather?.summary.pv_forecast_kwh ?? null) : null;
  let peak: { t: number; w: number } | null = null;
  const t = series?.t ?? [];
  const v = series?.pv_power ?? [];
  for (let i = 0; i < t.length; i++) {
    const w = v[i];
    if (w != null && w > ON && (!peak || w > peak.w)) peak = { t: t[i], w };
  }
  const at = place(s);
  const sun = at ? sunDay(midnight(now) + 43_200, at.lat, at.lon) : null;
  const hour = weather?.hours.find((h) => h.ts <= now && now < h.ts + 3600);
  return {
    made,
    heading,
    likely:
      made != null && rest != null && range && rest > 0.1
        ? { low: made + rest * range.low, high: made + rest * range.high }
        : null,
    planned,
    /** Where today's heading against this morning's forecast: +0.08 is 8% ahead. */
    pace: heading != null && planned != null && planned > 0.5 ? heading / planned - 1 : null,
    peak,
    tomorrow: f?.days.find((d) => d.date === dateKey(addDays(midnight(now), 1))) ?? null,
    sun,
    cloud: hour?.cloud ?? null,
  };
}

/**
 * Each string of panels the hybrid tracks (its MPPTs): volts, amps and the power they make. Strings reading no
 * voltage aren't connected and are left out.
 */
export function stringsOf(p: Snapshot | null) {
  const list = [1, 2]
    .map((n) => {
      const v = p?.[`mppt${n}_v`] ?? null;
      const a = p?.[`mppt${n}_a`] ?? null;
      return { n, v, a, w: v != null && a != null ? v * a : null };
    })
    .filter((x) => x.v != null && x.v > 0);
  const [one, two] = list;
  return {
    list,
    /** How far apart two strings are, as a share of the stronger (0 is level); only once there's some sun. */
    apart:
      one?.w != null && two?.w != null && one.w + two.w > 200 ? Math.abs(one.w - two.w) / Math.max(one.w, two.w) : null,
  };
}

/** Each inverter's solar, when a second (AC-coupled) one is set up; none otherwise. */
export function invertersOf(p: Snapshot | null, s: SystemInfo | undefined) {
  const pv2 = s?.pv2;
  if (!pv2) return [];
  return [
    { name: s?.model ?? "Hybrid", w: p?.pv1_power ?? null, kwh: p?.daily_pv1 ?? null, temp: p?.inverter_temp ?? null },
    {
      name: [pv2.brand, pv2.model].filter(Boolean).join(" ") || "Second inverter",
      w: p?.pv2_power ?? null,
      kwh: p?.daily_pv2 ?? null,
      temp: p?.pv2_temp ?? null,
    },
  ];
}

export type PastDay = { date: string; kwh: number; forecast: number | null; ratio: number | null };

/**
 * The days before today, up to 30: what each made, with its forecast when the forecast's record has it, and how it
 * did against the weather. From the forecast's record when there is one, else from the performance days.
 */
export function pastDays(
  acc: ForecastAccuracy | null | undefined,
  performance: SolarInsights["performance"] | undefined,
  now: number,
): PastDay[] {
  const today = dateKey(now);
  const perf = performance?.days ?? [];
  const ratio = (date: string) => perf.find((x) => x.date === date)?.ratio ?? null;
  const days: PastDay[] = acc?.days.length
    ? acc.days.map((d) => ({ date: d.date, kwh: d.actual_kwh, forecast: d.forecast_kwh, ratio: ratio(d.date) }))
    : perf.flatMap((d) =>
        d.actual_kwh != null ? [{ date: d.date, kwh: d.actual_kwh, forecast: null, ratio: d.ratio }] : [],
      );
  return days.filter((d) => d.date < today).slice(-30);
}
