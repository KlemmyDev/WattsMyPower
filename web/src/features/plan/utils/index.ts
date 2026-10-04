import type { CostDay, HistorySeries } from "~/features/common/readings/types";
import type { Snapshot } from "~/features/common/live/types";
import type { Tariff } from "~/features/common/tariffs/types";
import type { Forecast, ForecastAccuracy, ForecastDay, ForecastHour } from "~/features/common/weather/types";
import { hhmm, weekdayLong } from "~/features/common/formatting/utils/date";
import { kWh, kWhInt, pct } from "~/features/common/formatting/utils/number";
import { energyToday } from "~/features/common/energy/utils";
import { addDays, midnight } from "~/features/common/time/utils";
import { tariffNumber } from "~/features/common/tariffs/utils";
import type { Rates } from "~/features/plan/utils/rates";

/* The figures behind the Plan page: each day's totals, when to use power, and what to look out for. */

export const hourEnd = (h: ForecastHour) => h.ts + 3600;
/** An hour's energy (kWh) from its average power, over the part of it the forecast covers. */
export const hourKwh = (h: ForecastHour, kw: number) => (kw * (hourEnd(h) - h.start)) / 3600;

/** What forecast hours cost on the grid: imports at the buy price, less exports at the feed-in price. */
export function hoursCost(hrs: ForecastHour[], r: Rates): number {
  return hrs.reduce(
    (a, h) =>
      a + Math.max(0, h.grid_kwh) * r.buy(h.start, hourEnd(h)) - Math.max(0, -h.grid_kwh) * r.sell(h.start, hourEnd(h)),
    0,
  );
}

export type PlanDay = {
  key: string;
  start: number;
  label: string;
  today: boolean;
  day: ForecastDay;
  /** The forecast hours in the day: from now on, today. */
  hours: ForecastHour[];
  /** Whole-day figures (kWh). On today, what's been recorded so far plus the forecast for the rest. */
  pv: number;
  load: number;
  /** Planned car charging (kWh from the wall), still to come. */
  car: number;
  /** Today only: what's been recorded so far (kWh); the rest of `pv` and `load` is forecast. */
  soFar: { pv: number; load: number } | null;
  imp: number;
  exp: number;
  /** Solar on 8 in 10 days like it, from how the forecast has done (today's recorded part counts as it is). */
  pvRange: [number, number] | null;
  /** The battery over the whole day: full now, when it fills (or filled, today), or the highest it gets. */
  battery: { now: boolean; fullAt: number | null; max: number };
  /** The day's bill, supply charge included: today's so far plus the rest. Null without rates. */
  cost: number | null;
};

/** Today's highest battery level so far, and when it first reached full. */
export function recordedBattery(series: HistorySeries | undefined) {
  let maxSoc: number | null = null;
  let fullAt: number | null = null;
  series?.t.forEach((t, i) => {
    const soc = series.battery_soc?.[i];
    if (soc == null) return;
    maxSoc = Math.max(maxSoc ?? 0, soc);
    if (fullAt == null && soc >= 99.5) fullAt = t;
  });
  return { maxSoc, fullAt };
}

/** Today and the next two days, as the outlook cards and the day plan show them. */
export function planDays(
  f: Forecast,
  {
    now,
    snapshot,
    tariff,
    rates,
    todayCost,
    range,
    recorded,
  }: {
    now: number;
    snapshot: Snapshot | null | undefined;
    tariff: Tariff | undefined;
    rates: Rates | null;
    todayCost: CostDay | undefined;
    range: ForecastAccuracy["range"] | undefined;
    /** Today's readings so far: the highest battery level, and when it first reached full. */
    recorded: { maxSoc: number | null; fullAt: number | null };
  },
): PlanDay[] {
  const tomorrow = addDays(midnight(now), 1);
  return f.days.map((day) => {
    const today = day.from > day.start;
    const end = addDays(day.start, 1);
    const hours = f.hours.filter((h) => day.start <= h.start && h.start < end);
    const so = today ? energyToday(snapshot) : null;
    const pvSoFar = so?.pv ?? 0;
    const rest = rates ? hoursCost(hours, rates) : 0;
    const cost = !tariff
      ? null
      : today
        ? (todayCost?.net_cost ?? tariffNumber(tariff.supply_charge)) + rest
        : rest + tariffNumber(tariff.supply_charge);
    return {
      key: day.date,
      start: day.start,
      label: today ? "Today" : day.start === tomorrow ? "Tomorrow" : weekdayLong.format(day.start * 1000),
      today,
      day,
      hours,
      pv: pvSoFar + day.pv_kwh,
      load: (so?.home ?? 0) + day.load_kwh,
      car: day.car_kwh ?? 0,
      soFar: so ? { pv: so.pv, load: so.home } : null,
      imp: (so?.imp ?? 0) + day.import_kwh,
      exp: (so?.exp ?? 0) + day.export_kwh,
      // No range for a day whose solar is already in.
      pvRange:
        range && day.pv_kwh >= 0.5 ? [pvSoFar + day.pv_kwh * range.low, pvSoFar + day.pv_kwh * range.high] : null,
      battery: {
        now: day.full_now,
        fullAt: (today ? recorded.fullAt : null) ?? day.full_at,
        max: Math.max(day.max_soc, today ? (recorded.maxSoc ?? 0) : 0),
      },
      cost,
    };
  });
}

/** A run of hours worth acting on: spare solar to use, grid power to avoid, or prices below zero. */
export type Window = {
  kind: "spare" | "avoid" | "paid";
  start: number;
  end: number;
  /** Spare: kWh that would go to the grid. Avoid: kWh from it. Paid: kWh from it while prices are negative. */
  kwh: number;
  /** The average price over it ($/kWh): feed-in for spare solar, the buy price otherwise. Null without rates. */
  rate: number | null;
  /** The band or source of the price ("Peak", "Amber"), when it's worth naming. */
  band: string | null;
  /** Planned car charging in the window (kWh from the wall). */
  car: number;
};

const MIN_HOUR = 0.2; // kWh in an hour before it counts toward a window
const MIN_WINDOW = 0.5; // kWh a window needs to be worth showing

/** Runs of consecutive hours that pass `keep`. */
function runs(hrs: ForecastHour[], keep: (h: ForecastHour) => boolean): ForecastHour[][] {
  const out: ForecastHour[][] = [];
  let cur: ForecastHour[] = [];
  for (const h of hrs) {
    if (keep(h)) cur.push(h);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A run of hours as a window: its energy, and its price averaged over that energy. */
function windowOf(
  kind: Window["kind"],
  hrs: ForecastHour[],
  kwh: (h: ForecastHour) => number,
  price: ((h: ForecastHour) => number) | null,
  band: string | null = null,
): Window {
  const total = hrs.reduce((a, h) => a + kwh(h), 0);
  return {
    kind,
    start: hrs[0].start,
    end: hourEnd(hrs[hrs.length - 1]),
    kwh: total,
    rate: price && total > 0 ? hrs.reduce((a, h) => a + price(h) * kwh(h), 0) / total : null,
    band,
    car: hrs.reduce((a, h) => a + hourKwh(h, h.car_kw ?? 0), 0),
  };
}

/**
 * When to use power on a day, from its forecast hours:
 *  - spare solar: hours that would send solar to the grid, once the battery is as full as it gets;
 *  - grid to avoid: the costliest hours the house is forecast to draw from the grid (on a single
 *    rate, the hours it draws the most), at most two runs of them;
 *  - on Amber, hours when the price to buy goes below zero.
 */
export function bestTimes(hrs: ForecastHour[], r: Rates | null): { spare: Window[]; avoid: Window[]; paid: Window[] } {
  const exported = (h: ForecastHour) => Math.max(0, -h.grid_kwh);
  const imported = (h: ForecastHour) => Math.max(0, h.grid_kwh);
  const buy = (h: ForecastHour) => (r ? r.buy(h.start, hourEnd(h)) : 0);
  const sell = (h: ForecastHour) => (r ? r.sell(h.start, hourEnd(h)) : 0);

  const spare = runs(hrs, (h) => exported(h) >= MIN_HOUR)
    .map((run) => windowOf("spare", run, exported, r && sell))
    .filter((w) => w.kwh >= MIN_WINDOW);

  const drawing = hrs.filter((h) => imported(h) >= MIN_HOUR);
  const prices = drawing.map(buy);
  const hi = Math.max(...prices, 0);
  const lo = Math.min(...prices, hi);
  // Prices that differ: the top quarter of the day's spread. A single rate: every hour drawing from the grid.
  const dear = (h: ForecastHour) => imported(h) >= MIN_HOUR && (hi - lo < 0.01 || buy(h) >= hi - (hi - lo) * 0.25);
  const avoid = runs(hrs, dear)
    .map((run) => windowOf("avoid", run, imported, r && buy, r?.name(run[0].start, hourEnd(run[0]))))
    .filter((w) => w.kwh >= MIN_WINDOW)
    .sort((a, b) => b.kwh * (b.rate ?? 1) - a.kwh * (a.rate ?? 1))
    .slice(0, 2)
    .sort((a, b) => a.start - b.start);

  const paid = r
    ? runs(hrs, (h) => r.name(h.start, hourEnd(h)) === "Amber" && buy(h) < 0).map((run) =>
        windowOf("paid", run, (h) => hourKwh(h, h.load_kw), buy, "Amber"),
      )
    : [];
  return { spare, avoid, paid };
}

export type Note = { tone: "warn" | "info"; title: string; sub: string };

/** What's worth knowing ahead of time: the battery running down to its reserve, not filling, or a dull day. */
export function notices(days: PlanDay[], reserve: number, usual: number | null | undefined): Note[] {
  const out: Note[] = [];
  const hours = days.flatMap((d) => d.hours);
  const low = hours.findIndex((h, k) => h.soc <= reserve + 0.5 && (k === 0 || hours[k - 1].soc > reserve + 0.5));
  if (low >= 0 && hours[low].start < hours[0].start + 86400) {
    const back = hours.slice(low).find((h) => h.soc > reserve + 0.5);
    out.push({
      tone: "info",
      title: `Battery reaches its ${reserve}% reserve around ${hhmm(hourEnd(hours[low]))}`,
      sub: back
        ? `Your home runs on the grid until about ${hhmm(back.start)}, when solar starts charging it again.`
        : "Your home runs on the grid after that.",
    });
  }
  // Only days with sun still to come: there's nothing to plan around in a day that's done.
  const sunLeft = (d: PlanDay) => d.hours.some((h) => h.is_day && h.pv_kw >= 0.1);
  const when = (d: PlanDay) => (d.today ? "today" : d.label === "Tomorrow" ? "tomorrow" : `on ${d.label}`);
  for (const d of days.filter(sunLeft)) {
    const fills = d.battery.now || d.battery.fullAt != null;
    if (usual && usual >= 2 && d.pv < usual * 0.5) {
      const better = days.find((o) => o !== d && o.pv >= usual * 0.8 && sunLeft(o));
      out.push({
        tone: "warn",
        title: `${d.label} looks dull: about ${kWhInt(d.pv)} of solar`,
        sub:
          `That's under half a usual day lately (${kWhInt(usual)})` +
          (fills ? "." : `, and the battery should top out around ${pct(d.battery.max)}.`) +
          (better ? ` ${better.label} looks better for big loads like washing or charging a car.` : ""),
      });
    } else if (!fills) {
      out.push({
        tone: "warn",
        title: `Battery unlikely to fill ${when(d)}`,
        sub: `It should top out around ${pct(d.battery.max)}, with ${kWh(d.pv)} of solar against ${kWh(d.load)} of home use.`,
      });
    }
  }
  return out;
}
