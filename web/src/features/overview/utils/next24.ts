import type { AmberPrices } from "~/features/amber/types";
import { averageOver } from "~/features/amber/utils";
import type { Forecast, ForecastHour } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh, kWhInt, money } from "~/features/common/formatting/utils/number";
import { bandAt, tariffNumber } from "~/features/common/tariffs/utils";
import { reserveOf } from "~/features/common/energy/utils";
import { isWet } from "~/features/common/weather/utils";

/* The figures behind the Overview's "Next 24 hours" card: headline, key moments, chart geometry, and totals. */

export const W = 600;
/** Heights of the solar / home use plot and the battery level plot. */
export const PH = 110;
export const BH = 56;
const DAY = 86400;
const STEP = 300; // the hover readout's step: 5 minutes

type V = { t: number; v: number };
type Moment = { t: number; title: string; sub: string; color: string };

/** `prices`: Amber's forecast, used for the expected cost when the rates follow Amber's prices. */
export function next24(f: Forecast, p: Snapshot | null, s: SystemInfo | undefined, now: number, prices?: AmberPrices) {
  const end = now + DAY;
  const t = s?.tariff;
  const reserve = reserveOf(s);
  const hrs = f.hours.filter((h) => h.start < end);
  if (!hrs.length) return null;

  const X = (ts: number) => ((Math.min(end, Math.max(now, ts)) - now) / DAY) * W;
  const left = (ts: number) => (X(ts) / W) * 100;
  const mid = (h: ForecastHour) => h.start + (h.ts + 3600 - h.start) / 2;
  const last = hrs[hrs.length - 1];
  const pv: V[] = [
    { t: now, v: hrs[0].pv_kw },
    ...hrs.map((h) => ({ t: mid(h), v: h.pv_kw })),
    { t: end, v: last.pv_kw },
  ];
  const load: V[] = [
    { t: now, v: hrs[0].load_kw },
    ...hrs.map((h) => ({ t: mid(h), v: h.load_kw })),
    { t: end, v: last.load_kw },
  ];
  const socPts: V[] = [
    { t: now, v: p && p.battery_soc != null ? p.battery_soc : hrs[0].soc },
    ...hrs.map((h) => ({ t: Math.min(end, h.ts + 3600), v: h.soc })),
  ];
  const peak = Math.max(...pv.map((x) => x.v));
  const mx = Math.max(1, peak, ...load.map((x) => x.v)) * 1.1;
  const py = (v: number) => PH - 2 - (v / mx) * (PH - 10);
  const by = (soc: number) => BH - 2 - (soc / 100) * (BH - 4);
  const path = (arr: V[], fy: (v: number) => number) =>
    arr.map((x, k) => `${k ? "L" : "M"}${X(x.t).toFixed(1)} ${fy(x.v).toFixed(1)}`).join(" ");
  // A dashed guide at a round kW figure near the solar peak.
  const guideKw = Math.max(1, Math.round(peak));

  // The hover readout, every 5 minutes on the clock. The forecast is hourly, so values are read
  // off the lines as drawn (straight between its points), and grid flow is its hour's average power.
  const lerp = (arr: V[], ts: number) => {
    const k = arr.findIndex((x) => x.t >= ts);
    if (k <= 0) return k === 0 ? arr[0].v : arr[arr.length - 1].v;
    const a = arr[k - 1];
    const b = arr[k];
    return a.v + ((b.v - a.v) * (ts - a.t)) / (b.t - a.t || 1);
  };
  const first = Math.ceil(now / STEP) * STEP;
  const points = Array.from({ length: Math.floor((end - first) / STEP) }, (_, k) => {
    const ts = first + k * STEP;
    const h = hrs.find((x) => x.start <= ts && ts < x.ts + 3600) ?? last;
    const pvKw = lerp(pv, ts);
    const loadKw = lerp(load, ts);
    const soc = lerp(socPts, ts);
    return {
      t: ts,
      h,
      pv: pvKw,
      load: loadKw,
      soc,
      grid: h.grid_kwh / ((h.ts + 3600 - h.start) / 3600), // kW, + from the grid
      left: left(ts),
      // as percentages of each plot's height, for the dots on the lines
      pvTop: (py(pvKw) / PH) * 100,
      loadTop: (py(loadKw) / PH) * 100,
      socTop: (by(soc) / BH) * 100,
    };
  });

  // Shaded spans for the hours after dark.
  const nights: { x: number; w: number }[] = [];
  let n0: number | null = null;
  hrs.forEach((h, k) => {
    const dark = !h.is_day;
    if (dark && n0 === null) n0 = h.start;
    if ((!dark || k === hrs.length - 1) && n0 !== null) {
      const x1 = dark ? end : h.start;
      nights.push({ x: X(n0), w: X(x1) - X(n0) });
      n0 = null;
    }
  });

  // Key moments, numbered in time order.
  const fullAt = f.summary.full_at && f.summary.full_at > now && f.summary.full_at < end ? f.summary.full_at : null;
  const sunDrop = hrs.find(
    (h, k) => k > 0 && h.is_day && new Date(h.ts * 1000).getHours() >= 13 && h.pv_kw < h.load_kw,
  );
  const resH = hrs.find((h) => h.soc <= reserve + 0.5 && (!fullAt || h.start > fullAt));
  const resAt = resH ? Math.min(end, resH.ts + 3600) : null;
  // The first daytime rain, which is the only rain that matters for solar.
  const wet = (h: ForecastHour) => isWet(h.code) || h.precip >= 50;
  const k0 = hrs.findIndex((h) => wet(h) && h.is_day);
  const wetEnd = k0 < 0 ? -1 : hrs.findIndex((h, k) => k > k0 && !wet(h));
  const showers = k0 < 0 ? null : { t: hrs[k0].start, until: wetEnd < 0 ? last.ts + 3600 : hrs[wetEnd].ts };
  const moments: Moment[] = [];
  if (fullAt) moments.push({ t: fullAt, title: "Battery full", sub: "Extra solar goes to the grid", color: "#6f8cff" });
  if (sunDrop)
    moments.push({
      t: sunDrop.ts,
      title: "Solar drops below home use",
      sub: "Battery starts powering your home",
      color: "#ffb547",
    });
  if (resAt)
    moments.push({
      t: resAt,
      title: "Battery reaches reserve",
      sub: "Your home runs on the grid until morning",
      color: "#b0b0b5",
    });
  if (showers)
    moments.push({
      t: showers.t,
      title: `Showers until ${hhmm(showers.until)}`,
      sub: new Date(showers.t * 1000).getHours() < 12 ? "Lower solar early in the day" : "Lower solar while it rains",
      color: "#9fb2ff",
    });
  moments.sort((a, b) => a.t - b.t);
  const today = new Date(now * 1000).toDateString();

  // One weather reading every three hours, taken at the middle of each three-hour slot: that's
  // where its icon sits above the chart.
  const weather = Array.from({ length: 8 }, (_, k) => {
    const at = now + (k * 3 + 1.5) * 3600;
    const h = f.hours.find((x) => x.ts <= at && at < x.ts + 3600) || hrs[Math.min(hrs.length - 1, k * 3)];
    return { at, h };
  });

  // Totals for the next 24 hours
  const kwhOf = (h: ForecastHour, v: number) => (v * (h.ts + 3600 - h.start)) / 3600;
  const use = hrs.reduce((a, h) => a + kwhOf(h, h.load_kw), 0);
  const imp = hrs.reduce((a, h) => a + Math.max(0, h.grid_kwh), 0);
  const cover = use > 0 ? Math.max(0, Math.min(1, 1 - imp / use)) : 1;
  // On Amber, each hour at its forecast prices (the fallback rates where there's no forecast yet).
  const amber = t?.type === "amber" ? prices : undefined;
  const buyAt = (h: ForecastHour) =>
    (amber && averageOver(amber.general, h.start, h.ts + 3600)) ?? (t ? bandAt(t, h.start).rate : 0);
  const sellAt = (h: ForecastHour) =>
    (amber && averageOver(amber.feed_in, h.start, h.ts + 3600)) ?? (t ? tariffNumber(t.feed_in_rate) : 0);
  const cost = t
    ? hrs.reduce((a, h) => a + Math.max(0, h.grid_kwh) * buyAt(h) - Math.max(0, -h.grid_kwh) * sellAt(h), 0) +
      tariffNumber(t.supply_charge)
    : null;
  const stats: [label: string, value: string, color: string][] = [
    ["Solar forecast", kWhInt(f.summary.pv_kwh_24h), "#ffb547"],
    ["Expected use", kWhInt(use), "#f5f5f5"],
    ["From the grid", kWh(imp), "#f5f5f5"],
    ["Expected cost", money(cost), cost != null && cost < 0 ? "#3ee08f" : "#f5f5f5"],
  ];

  return {
    headline:
      `Solar and battery should cover ${Math.round(cover * 100)}% of your power. ` +
      (imp < 0.5 ? "You should barely need the grid." : `You will need about ${kWh(imp)} from the grid.`),
    cover: cover * 100,
    gridKwh: kWh(imp),
    moments: moments.map((m, i) => ({
      ...m,
      num: i + 1,
      time: hhmm(m.t),
      day: new Date(m.t * 1000).toDateString() === today ? "Today" : "Tomorrow",
      left: left(m.t),
    })),
    pvPath: path(pv, py),
    loadPath: path(load, py),
    socPath: path(socPts, by),
    guideKw,
    guideY: py(guideKw),
    reserve,
    reserveY: by(reserve),
    fullY: by(100),
    nights,
    points,
    /** One step of the hover readout, as a percentage of the plot's width. */
    stepWidth: (STEP / DAY) * 100,
    // as percentages of the plot width
    ticks: [0, 6, 12, 18, 24].map((o) => ({ left: (o / 24) * 100, label: o ? hhmm(now + o * 3600) : "Now" })),
    weather,
    stats,
  };
}
