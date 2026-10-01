import type { CostDay } from "~/features/common/readings/types";
import type { DailyRow } from "~/features/history/types";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { addDays, dateKey } from "~/features/common/time/utils";
import type { Metric } from "~/features/history/utils/search";

type DayBase = { i: number; ts: number; key: string };
export type DataDay = DayBase & {
  kind: "data";
  gen: number;
  imp: number;
  exp: number;
  home: number;
  ss: number; // 0–1
  saved: number;
  partial: boolean; // today, still filling in
};
/** "future": after today; "pending": the year is still loading; "none": no readings that day. */
export type Day = (DayBase & { kind: "future" | "pending" | "none" }) | DataDay;

export const hasData = (d: Day): d is DataDay => d.kind === "data";

/** A calendar year, January to December. Days after today are left empty. */
export function buildDays(start: number, end: number, today: number, rows?: DailyRow[], costs?: CostDay[]): Day[] {
  const byDate = new Map(rows?.map((r) => [r.date, r]));
  const saved = new Map(costs?.map((d) => [d.date, d.saved]));
  return Array.from({ length: Math.round((end - start) / 86400) }, (_, i): Day => {
    const ts = addDays(start, i);
    const key = dateKey(ts);
    if (ts > today) return { i, ts, key, kind: "future" };
    if (!rows || !costs) return { i, ts, key, kind: "pending" };
    const r = byDate.get(key);
    if (!r || r.daily_pv == null || r.daily_import == null || r.daily_export == null)
      return { i, ts, key, kind: "none" };
    const gen = r.daily_pv;
    const imp = r.daily_import;
    const exp = r.daily_export;
    const home = Math.max(0, gen + imp - exp + (r.daily_discharge || 0) - (r.daily_charge || 0));
    const ss = home > 0 ? Math.max(0, Math.min(1, (home - imp) / home)) : 0;
    return { i, ts, key, kind: "data", gen, imp, exp, home, ss, saved: saved.get(key) || 0, partial: ts === today };
  });
}

export const METRICS: Record<
  Metric,
  { label: string; value: (d: DataDay) => number; format: (v: number) => string; color: string }
> = {
  gen: { label: "Solar", value: (d) => d.gen, format: kWh, color: "#ffb547" },
  ss: { label: "Self-sufficiency", value: (d) => d.ss, format: (v) => `${Math.round(v * 100)}%`, color: "#3ee08f" },
  imp: { label: "Grid import", value: (d) => d.imp, format: kWh, color: "#9aa4ff" },
  saved: { label: "Saved", value: (d) => d.saved, format: money, color: "#f5f5f5" },
};

/** A metric colour blended into the empty-cell grey; `v` from 0 (least) to 1 (most). */
export const heatColor = (color: string, v: number) =>
  `color-mix(in oklch, ${color} ${Math.round(12 + v * 88)}%, #1b1b1d)`;

/** One calendar cell. Without a label it's an empty placeholder; without a fill, a day with no readings. */
export type Cell = { i: number; ts: number; label: string | null; fill: string | null };

export function heatCells(days: Day[], metric: Metric): Cell[] {
  const { value, format, color } = METRICS[metric];
  // Colour by where each day sits between the year's lowest and highest (whole days only).
  const vals = days
    .filter(hasData)
    .filter((d) => !d.partial)
    .map(value);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const norm = (d: DataDay) => Math.max(0, Math.min(1, (value(d) - lo) / (hi - lo || 1)));
  return days.map((d) => {
    const base = { i: d.i, ts: d.ts };
    if (hasData(d))
      return {
        ...base,
        label: `${dayMonth(d.ts)}${d.partial ? " so far" : ""}: ${format(value(d))}`,
        fill: heatColor(color, norm(d)),
      };
    if (d.kind === "none") return { ...base, label: `${dayMonth(d.ts)}: no readings`, fill: null };
    return { ...base, label: null, fill: null };
  });
}

export type YearTotals = { days: number; gen: number; imp: number; exp: number; home: number; saved: number };

export function yearTotals(days: Day[]): YearTotals {
  const t: YearTotals = { days: 0, gen: 0, imp: 0, exp: 0, home: 0, saved: 0 };
  for (const d of days.filter(hasData)) {
    t.days++;
    t.gen += d.gen;
    t.imp += d.imp;
    t.exp += d.exp;
    t.home += d.home;
    t.saved += d.saved;
  }
  return t;
}
