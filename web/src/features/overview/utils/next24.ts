import type { Forecast, ForecastHour } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { bandAt, tariffNumber } from "~/features/common/tariffs/utils";
import { reserveOf } from "~/features/common/energy/utils";

/* The figures behind the Overview's "Next 24 hours" card: chart geometry, the story line, and totals. */

export const W = 600;
export const H = 170;
const DAY = 86400;

type V = { t: number; v: number };
type Mark = { t: number; soc: number; label: string; color: string };

export function next24(f: Forecast, p: Snapshot | null, s: SystemInfo | undefined, now: number) {
  const end = now + DAY;
  const t = s?.tariff;
  const reserve = reserveOf(s);
  const hrs = f.hours.filter((h) => h.start < end);
  if (!hrs.length) return null;

  const X = (ts: number) => ((Math.min(end, Math.max(now, ts)) - now) / DAY) * W;
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
  const mx = Math.max(1, ...pv.map((x) => x.v), ...load.map((x) => x.v)) * 1.1;
  const Y = (v: number) => H - 6 - (v / mx) * (H - 30);
  const YS = (v: number) => H - 6 - (v / 100) * (H - 30);
  const path = (arr: V[], fy: (v: number) => number) =>
    arr.map((x, k) => `${k ? "L" : "M"}${X(x.t).toFixed(1)} ${fy(x.v).toFixed(1)}`).join(" ");

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

  const fullAt = f.summary.full_at && f.summary.full_at < end ? f.summary.full_at : null;
  const resH = hrs.find((h) => h.soc <= reserve + 0.5 && (!fullAt || h.start > fullAt));
  const resAt = resH ? Math.min(end, resH.ts + 3600) : null;
  const marks: Mark[] = [];
  if (fullAt) marks.push({ t: fullAt, soc: 100, label: `Full ${hhmm(fullAt)}`, color: "#6f8cff" });
  if (resH && resAt) marks.push({ t: resAt, soc: resH.soc, label: `Reserve ${hhmm(resAt)}`, color: "#8a8a90" });

  // One weather reading every three hours.
  const weather = Array.from({ length: 8 }, (_, k) => {
    const at = now + k * 3 * 3600;
    const h = f.hours.find((x) => x.ts <= at && at < x.ts + 3600) || hrs[Math.min(hrs.length - 1, k * 3)];
    return { at, h };
  });

  // Story
  const sunDrop = hrs.find(
    (h, k) => k > 0 && h.is_day && new Date(h.ts * 1000).getHours() >= 13 && h.pv_kw < h.load_kw,
  );
  const tm = f.summary.tomorrow_morning || "";
  const tomorrow = /^Showers /.test(tm)
    ? ` Showers are expected ${tm.slice(8)} tomorrow.`
    : tm && tm !== "No forecast"
      ? ` Tomorrow morning looks ${tm.toLowerCase()}.`
      : "";
  const story =
    (p && (p.battery_soc ?? 0) >= 99.5
      ? "Your battery is full."
      : fullAt
        ? `Your battery should be full by ${hhmm(fullAt)}.`
        : "Your battery won't quite fill in the next 24 hours.") +
    (sunDrop ? ` Solar drops below home use around ${hhmm(sunDrop.ts)}` : "") +
    (sunDrop
      ? resAt
        ? `, and the battery reaches its reserve at about ${hhmm(resAt)}.`
        : ", and the battery should last the night."
      : resAt
        ? ` The battery reaches its reserve at about ${hhmm(resAt)}.`
        : "") +
    tomorrow;

  // Totals for the next 24 hours
  const kwhOf = (h: ForecastHour, v: number) => (v * (h.ts + 3600 - h.start)) / 3600;
  const use = hrs.reduce((a, h) => a + kwhOf(h, h.load_kw), 0);
  const imp = hrs.reduce((a, h) => a + Math.max(0, h.grid_kwh), 0);
  const cost = t
    ? hrs.reduce(
        (a, h) =>
          a +
          Math.max(0, h.grid_kwh) * bandAt(t, h.start).rate -
          Math.max(0, -h.grid_kwh) * tariffNumber(t.feed_in_rate),
        0,
      ) + tariffNumber(t.supply_charge)
    : null;
  const stats: [label: string, value: string, color: string][] = [
    ["Solar forecast", `${Math.round(f.summary.pv_kwh_24h)} kWh`, "#ffb547"],
    ["Expected use", `${Math.round(use)} kWh`, "#f5f5f5"],
    ["From the grid", kWh(imp), "#f5f5f5"],
    ["Expected cost", money(cost), cost != null && cost < 0 ? "#3ee08f" : "#f5f5f5"],
  ];

  return {
    pvPath: path(pv, Y),
    loadPath: path(load, Y),
    socPath: path(socPts, YS),
    nights,
    // as percentages of the plot, for the HTML dots and labels
    marks: marks.map((m) => ({ ...m, left: (X(m.t) / W) * 100, top: (YS(m.soc) / H) * 100 })),
    ticks: [0, 6, 12, 18, 24].map((o) => ({ left: (o / 24) * 100, label: o ? hhmm(now + o * 3600) : "Now" })),
    weather,
    story,
    stats,
  };
}
