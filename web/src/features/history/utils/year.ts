import type { CostDay } from "~/features/common/readings/types";
import type { DailyRow } from "~/features/history/types";
import { dayMonth, monthLong, monthShort } from "~/features/common/formatting/utils/date";
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
  /** Home use met straight from the panels, from the battery, and (imp) from the grid. */
  direct: number;
  battery: number;
  ss: number; // 0–1
  saved: number;
  credit: number; // feed-in credit, AUD
  partial: boolean; // today, still filling in
};
/** "future": after today; "pending": still loading; "none": no readings that day. */
export type Day = (DayBase & { kind: "future" | "pending" | "none" }) | DataDay;

export const hasData = (d: Day): d is DataDay => d.kind === "data";
/** Days with data, today (still filling in) left out. */
export const wholeDays = (days: Day[]) => days.filter(hasData).filter((d) => !d.partial);

/** Every day from `start` up to `end`. Days after today are left empty. */
export function buildDays(start: number, end: number, today: number, rows?: DailyRow[], costs?: CostDay[]): Day[] {
  const byDate = new Map(rows?.map((r) => [r.date, r]));
  const cost = new Map(costs?.map((d) => [d.date, d]));
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
    const charge = r.daily_charge || 0;
    const home = Math.max(0, gen + imp - exp + (r.daily_discharge || 0) - charge);
    const covered = Math.max(0, home - imp);
    // Solar used as it was made; the rest of what the grid didn't supply came from the battery.
    const direct = Math.min(covered, Math.max(0, r.daily_direct ?? gen - exp - charge));
    const ss = home > 0 ? Math.max(0, Math.min(1, covered / home)) : 0;
    const c = cost.get(key);
    return {
      i,
      ts,
      key,
      kind: "data",
      gen,
      imp,
      exp,
      home,
      direct,
      battery: covered - direct,
      ss,
      saved: c?.saved || 0,
      credit: c?.feed_in_credit || 0,
      partial: ts === today,
    };
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

/**
 * One calendar cell. Without a label it's an empty placeholder; without a fill, a day with no
 * readings. `v` is where the day sits from the view's lowest (0) to highest (1).
 */
export type Cell = { i: number; ts: number; label: string | null; fill: string | null; v: number | null };

export function heatCells(days: Day[], metric: Metric): Cell[] {
  const { value, format, color } = METRICS[metric];
  // Colour by where each day sits between the view's lowest and highest (whole days only).
  const vals = wholeDays(days).map(value);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const norm = (d: DataDay) => Math.max(0, Math.min(1, (value(d) - lo) / (hi - lo || 1)));
  return days.map((d) => {
    const base = { i: d.i, ts: d.ts };
    if (hasData(d)) {
      const v = norm(d);
      return {
        ...base,
        label: `${dayMonth(d.ts)}${d.partial ? " so far" : ""}: ${format(value(d))}`,
        fill: heatColor(color, v),
        v,
      };
    }
    if (d.kind === "none") return { ...base, label: `${dayMonth(d.ts)}: no readings`, fill: null, v: null };
    return { ...base, label: null, fill: null, v: null };
  });
}

export type Totals = {
  days: number;
  months: number;
  gen: number;
  imp: number;
  exp: number;
  home: number;
  saved: number;
  credit: number;
  /** Whole days that were at least 90% self-sufficient. */
  greatDays: number;
};

export function totalsOf(days: Day[]): Totals {
  const t: Totals = { days: 0, months: 0, gen: 0, imp: 0, exp: 0, home: 0, saved: 0, credit: 0, greatDays: 0 };
  const months = new Set<string>();
  for (const d of days.filter(hasData)) {
    t.days++;
    t.gen += d.gen;
    t.imp += d.imp;
    t.exp += d.exp;
    t.home += d.home;
    t.saved += d.saved;
    t.credit += d.credit;
    if (!d.partial && d.ss >= 0.9) t.greatDays++;
    months.add(d.key.slice(0, 7));
  }
  t.months = months.size;
  return t;
}

export type Month = {
  key: string; // YYYY-MM
  name: string; // "October"
  short: string; // "Oct"
  year: number;
  days: number;
  home: number;
  direct: number;
  battery: number;
  imp: number;
  exp: number;
  saved: number;
};

/** Each month's home use, split by where it came from, in the order the months come. */
export function monthsOf(days: Day[]): Month[] {
  const out: Month[] = [];
  for (const d of days.filter(hasData)) {
    const key = d.key.slice(0, 7);
    let m = out[out.length - 1];
    if (!m || m.key !== key) {
      const dt = new Date(d.ts * 1000);
      m = { key, name: monthLong.format(dt), short: monthShort.format(dt), year: dt.getFullYear(), days: 0, home: 0, direct: 0, battery: 0, imp: 0, exp: 0, saved: 0 }; // prettier-ignore
      out.push(m);
    }
    m.days++;
    m.home += d.home;
    m.direct += d.direct;
    m.battery += d.battery;
    m.imp += d.imp;
    m.exp += d.exp;
    m.saved += d.saved;
  }
  return out;
}

export type Standout = { title: string; color: string; day: DataDay; value: string; date?: string };

/** The view's record days, and its longest run of days barely using the grid. */
export function standoutsOf(days: Day[]): Standout[] {
  const whole = wholeDays(days);
  if (!whole.length) return [];
  const top = (f: (d: DataDay) => number) => whole.reduce((b, d) => (f(d) > f(b) ? d : b));
  const out: Standout[] = [
    { title: "Best solar day", color: "#ffb547", day: top((d) => d.gen), value: "" },
    { title: "Most self-sufficient", color: "#3ee08f", day: top((d) => d.ss), value: "" },
    { title: "Biggest saving", color: "#f5f5f5", day: top((d) => d.saved), value: "" },
    { title: "Highest use", color: "#9aa4ff", day: top((d) => d.home), value: "" },
    { title: "Most from the grid", color: "#8a8a90", day: top((d) => d.imp), value: "" },
  ];
  out[0].value = kWh(out[0].day.gen);
  out[1].value = `${Math.round(out[1].day.ss * 100)}%`;
  out[2].value = money(out[2].day.saved);
  out[3].value = kWh(out[3].day.home);
  out[4].value = kWh(out[4].day.imp);
  // A record of nothing (no saving, no grid use at all) isn't worth a card.
  const records = out.filter((s, k) => !((k === 2 && s.day.saved < 0.01) || (k === 4 && s.day.imp < 0.05)));

  // Consecutive days (with readings, one after another) using under 1 kWh from the grid.
  let best = { n: 0, from: whole[0] };
  let run = 0;
  let from = whole[0];
  whole.forEach((d, k) => {
    const follows = k > 0 && d.i === whole[k - 1].i + 1;
    if (d.imp < 1) {
      if (!run || !follows) [run, from] = [0, d];
      run++;
      if (run > best.n) best = { n: run, from };
    } else run = 0;
  });
  if (best.n > 1)
    records.push({
      title: "Longest run off the grid",
      color: "#3ee08f",
      day: best.from,
      value: `${best.n} days`,
      date: `From ${dayMonth(best.from.ts)}`,
    });
  return records;
}
