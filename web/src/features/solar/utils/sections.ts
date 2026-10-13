import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { COLOR, DEVICE_COLORS } from "~/features/common/theme/utils/colors";
import { addDays, offsetAt, partsOf, siteTime } from "~/features/common/time/utils";
import { sunDay } from "~/features/common/time/utils/sun";

/*
 * Pure helpers for Solar's section pages (Strings and inverters, Readings): each string's readings through a day, what
 * a day's power adds up to, and the stretches an inverter sat at its limit.
 */

/** A gap longer than this between readings isn't counted as the power carrying on through it. */
const MAX_STEP = 900;
/** Within this share of the limit either way, output is sitting at it. */
const AT_LIMIT = 0.03;
/** Readings in a row (5 minutes each) at the limit before it counts as held: a passing cloud edge doesn't. */
const HELD_RUN = 3;

/**
 * Each string's colour: solar orange and a clear blue, the pair that stays apart for colour-blind eyes, so two lines
 * crossing on a chart don't read as one.
 */
export const STRING_COLORS = [COLOR.solar, DEVICE_COLORS[5]];

export type Metric = "w" | "v" | "a";

/** One string's readings through a day: volts, amps, and the power they make (V × A of the 5-minute averages). */
export type StringDay = { n: number; color: string; v: (number | null)[]; a: (number | null)[]; w: (number | null)[] };

/**
 * The strings (MPPTs) the series has readings for, each with its power worked out. A string that read no voltage all
 * day isn't connected and is left out.
 */
export function stringDays(series: HistorySeries | undefined): StringDay[] {
  if (!series) return [];
  return [1, 2].flatMap((n, i) => {
    const v = series[`mppt${n}_v`] ?? [];
    const a = series[`mppt${n}_a`] ?? [];
    if (!v.some((x) => x != null && x > 0)) return [];
    const w = v.map((x, j) => (x != null && a[j] != null ? x * a[j]! : null));
    return [{ n, color: STRING_COLORS[i], v, a, w }];
  });
}

/** kWh from power readings (W) over time: each reading held until the next, unless the gap's too long to trust. */
export function energyOf(t: number[], w: (number | null)[]): number | null {
  let wh = 0;
  let any = false;
  for (let i = 0; i < t.length - 1; i++) {
    const x = w[i];
    const dt = t[i + 1] - t[i];
    if (x == null || dt > MAX_STEP) continue;
    wh += (Math.max(0, x) * dt) / 3600;
    any = true;
  }
  return any ? wh / 1000 : null;
}

/** The highest reading and when it was, or null with none. */
export function peakOf(t: number[], v: (number | null)[] | undefined): { t: number; v: number } | null {
  let best: { t: number; v: number } | null = null;
  for (let i = 0; i < t.length; i++) {
    const x = v?.[i];
    if (x != null && (!best || x > best.v)) best = { t: t[i], v: x };
  }
  return best;
}

/** The index of the reading nearest `at` that has a value in `v`, within `within` seconds. */
export function nearestIndex(t: number[], at: number, v?: (number | null)[], within = 600): number | null {
  let best: number | null = null;
  for (let i = 0; i < t.length; i++) {
    if (v && v[i] == null) continue;
    if (best == null || Math.abs(t[i] - at) < Math.abs(t[best] - at)) best = i;
  }
  return best != null && Math.abs(t[best] - at) <= within ? best : null;
}

/** The latest reading that has a value in `v`. */
export function lastIndex(v: (number | null)[] | undefined): number | null {
  if (!v) return null;
  for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i;
  return null;
}

/**
 * The stretches power sat at `limitW`: three or more readings in a row within 3% of it either way. Above it by more
 * isn't held (a hybrid's panels can feed the battery past its AC rating), nor is a moment's touch.
 */
export function heldStretches(t: number[], w: (number | null)[] | undefined, limitW: number) {
  const out: { from: number; to: number }[] = [];
  if (!w || limitW <= 0) return out;
  const step = t.length > 1 ? Math.min(MAX_STEP, t[1] - t[0]) : 300;
  let run: number[] = [];
  const close = () => {
    if (run.length >= HELD_RUN) out.push({ from: t[run[0]], to: t[run[run.length - 1]] + step });
    run = [];
  };
  for (let i = 0; i < t.length; i++) {
    const x = w[i];
    if (x != null && Math.abs(x - limitW) <= limitW * AT_LIMIT) run.push(i);
    else close();
  }
  close();
  return out;
}

/**
 * The part of a day worth charting: from an hour before sunrise to an hour after sunset, on the hour, where the system
 * has a place; else 4 am to 8 pm.
 */
export function daylightWindow(day: number, at: { lat: number; lon: number } | null): { from: number; to: number } {
  const p = partsOf(day);
  const fallback = { from: siteTime(p.year, p.month, p.day, 4), to: siteTime(p.year, p.month, p.day, 20) };
  if (!at) return fallback;
  const sun = sunDay(day + 43_200, at.lat, at.lon);
  if (sun.rise == null || sun.set == null) return fallback;
  // On the hour on the site's clock (half past in UTC, in Adelaide).
  const hour = 3600;
  const off = offsetAt(day);
  const from = Math.max(day, Math.floor((sun.rise - hour + off) / hour) * hour - off);
  const to = Math.min(addDays(day, 1), Math.ceil((sun.set + hour + off) / hour) * hour - off);
  return { from, to };
}

/** A day's reading times moved a day on, so yesterday's readings draw over today's at the same time of day. */
export function nextDay(t: number[]): number[] {
  return t.map((x) => addDays(x, 1));
}

/** A value with the true minus sign where it's negative, for a table of signed readings. */
export const signed = (v: number, digits: number) => {
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && /[1-9]/.test(s) ? `−${s}` : s;
};

/** One inverter's day: what it's making now and against what, today's total and peak, and how hot it's run. */
export type InverterDay = {
  key: string;
  name: string;
  kind: string;
  now: number | null;
  today: number | null;
  peak: { t: number; v: number } | null;
  temp: number | null;
  hottest: { t: number; v: number } | null;
  /** What it's measured against (W): the limit the readings show it held at, else its rating, else the array. */
  limit: { w: number; what: "limit" | "rating" | "array" } | null;
  /** The stretches today it sat at that limit (only for a real limit or rating, not the array). */
  held: { from: number; to: number }[];
};

/**
 * Each inverter's day, from the live reading and today's history. With one inverter it's the whole system, and the
 * limit the insights found output held at (`cappedKw`) is its own; with a second one each is measured against its own
 * rating, as the insights' limit is for the two together.
 */
export function inverterDays(
  p: Snapshot | null,
  s: SystemInfo | undefined,
  series: HistorySeries | undefined,
  cappedKw: number | null,
): InverterDay[] {
  const t = series?.t ?? [];
  const main = [s?.brand, s?.model].filter(Boolean).join(" ") || "Your inverter";
  const day = (
    key: string,
    name: string,
    kind: string,
    f: { now: number | null; today: number | null; power: string; temp: string; tempNow: number | null },
    limit: InverterDay["limit"],
  ): InverterDay => ({
    key,
    name,
    kind,
    now: f.now,
    today: f.today,
    peak: peakOf(t, series?.[f.power]),
    temp: f.tempNow,
    hottest: peakOf(t, series?.[f.temp]),
    limit,
    held: limit && limit.what !== "array" ? heldStretches(t, series?.[f.power], limit.w) : [],
  });
  const rated = (kw: number | null | undefined) => (kw ? { w: kw * 1000, what: "rating" as const } : null);
  const pv2 = s?.pv2;
  if (!pv2) {
    const limit = cappedKw
      ? { w: cappedKw * 1000, what: "limit" as const }
      : (rated(s?.nominal_kw) ?? (s?.pv_kw ? { w: s.pv_kw * 1000, what: "array" as const } : null));
    return [
      day(
        "main",
        main,
        s?.battery_kwh ? "Hybrid inverter, runs the battery" : "Solar inverter",
        {
          now: p?.pv_power ?? null,
          today: p?.daily_pv ?? null,
          power: "pv_power",
          temp: "inverter_temp",
          tempNow: p?.inverter_temp ?? null,
        },
        limit,
      ),
    ];
  }
  return [
    day(
      "main",
      main,
      s?.battery_kwh ? "Hybrid inverter, runs the battery" : "Main inverter",
      {
        now: p?.pv1_power ?? null,
        today: p?.daily_pv1 ?? null,
        power: "pv1_power",
        temp: "inverter_temp",
        tempNow: p?.inverter_temp ?? null,
      },
      rated(s?.nominal_kw),
    ),
    day(
      "pv2",
      [pv2.brand, pv2.model].filter(Boolean).join(" ") || "Second inverter",
      "Second inverter, solar only",
      {
        now: p?.pv2_power ?? null,
        today: p?.daily_pv2 ?? null,
        power: "pv2_power",
        temp: "pv2_temp",
        tempNow: p?.pv2_temp ?? null,
      },
      rated(pv2.nominal_kw),
    ),
  ];
}
