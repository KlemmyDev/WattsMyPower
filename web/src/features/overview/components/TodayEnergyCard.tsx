import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import type { AmberPrices } from "~/features/amber/types";
import { historyQuery } from "~/features/common/readings/api";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import type { Forecast } from "~/features/common/weather/types";
import { energyToday, homeSources, reserveOf } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { energyParts, kWh, powerParts } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { useForecastAccuracy } from "~/features/common/weather/hooks";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";
import { DayChart } from "~/features/history/components/DayChart";
import { extremesOf } from "~/features/history/utils/day";
import { PlanChart, type Overlay, type PlanParts } from "~/features/plan/components/PlanChart";
import { skyEvery3h, WeatherRow } from "~/features/plan/components/WeatherRow";
import { weatherDayQuery } from "~/features/weather/api";
import { bestTimes, hourEnd, hourKwh, planDays, recordedBattery, type PlanDay } from "~/features/plan/utils";
import { moments } from "~/features/plan/utils/moments";
import { ratesFor } from "~/features/plan/utils/rates";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc", "battery_power"];

/** Heights (px) of the parts, for what fits: the header and the gap under it (the gap between parts), a figure with
 * and without its line, where the power came from, and the links. */
const HEAD = 36 + 16;
const GAP = 16;
const FIGURE = 76;
const FIGURE_BARE = 56;
const SOURCES = 62;
const LINKS = 28;

/** The figures, in the order they're laid out. */
export const ENERGY_FIGURES = [
  { value: "solar", label: "Solar made" },
  { value: "home", label: "Home use" },
  { value: "ss", label: "Self-sufficiency" },
  { value: "peak", label: "Peak solar" },
  { value: "imp", label: "From the grid" },
  { value: "exp", label: "Sent to the grid" },
] as const;
type FigureKey = (typeof ENERGY_FIGURES)[number]["value"];
type Fig = { key: FigureKey; label: string; value: string; unit?: string; color: string; note?: string };

/** What the card shows, given room for it. */
export type EnergyShow = {
  /** The figure first (and, at the smallest, the only one). */
  lead: FigureKey;
  figures: FigureKey[];
  /** The line under each figure: what it should come to by midnight, a forecast's likely range, the peak's time. */
  notes: boolean;
  /** Where the home's power came from, as a bar. */
  sources: boolean;
  chart: boolean;
  /** The arrows on to tomorrow and the day after. */
  days: boolean;
  /** To History or the Plan, and comparing with the forecast. */
  links: boolean;
  parts: PlanParts;
  /** The day's best times and its key moments, across the chart's top. */
  moments: boolean;
};

/** A widget's settings as what it shows: everything on, unless switched off, led by the solar. */
export function energyShow(settings: Settings): EnergyShow {
  const on = (key: string) => settings[key] !== false;
  return {
    lead: ENERGY_FIGURES.find((x) => x.value === settings.lead)?.value ?? "solar",
    figures: ENERGY_FIGURES.filter((x) => on(x.value)).map((x) => x.value),
    notes: on("notes"),
    sources: on("sources"),
    chart: on("chart"),
    days: on("days"),
    links: on("links"),
    parts: { legend: on("legend"), weather: on("weather"), battery: on("battery"), flows: on("flows") },
    moments: on("moments"),
  };
}
const ALL = energyShow({});

/** How many figures go to a row at `w` columns, laid out under the header. */
const colsAt = (w: number, n: number) =>
  Math.max(1, Math.min(n, w <= 2 ? 1 : w <= 4 ? 2 : w <= 7 ? 3 : w >= 10 ? 6 : 3));

/**
 * The most rows the card can use at `w` columns for what it shows: with its chart, any (the chart takes what's
 * left); without, the header, the figures, where the power came from and the links.
 */
export function energyRows(show: EnergyShow, w: number) {
  if (show.chart && w >= 4) return undefined;
  const rows = Math.ceil(show.figures.length / colsAt(w, show.figures.length));
  const fig = show.notes ? FIGURE : FIGURE_BARE;
  return rowsFor(
    HEAD +
      rows * fig +
      Math.max(0, rows - 1) * GAP +
      (show.sources && w > 2 ? GAP + SOURCES : 0) +
      (show.links && w > 2 ? GAP + LINKS : 0),
  );
}

/**
 * What of the chart fits in `room` px: its parts as asked for, the hourly bars, the battery level, the legend, the
 * weather and the moments given up in turn until its plot has the height it needs, and the plot's height; or null
 * where even the plot alone won't fit.
 */
function chartFit(room: number, show: EnergyShow, narrow: boolean) {
  const parts = { ...show.parts, legend: show.parts.legend && !narrow };
  let marks = show.moments;
  const fixed = () =>
    (parts.legend ? 40 + 12 : 0) +
    (parts.weather ? 38 + 12 : 0) +
    (marks ? 48 : 22) +
    (parts.battery ? 94 : 0) +
    (parts.flows ? 74 : 0) +
    12 +
    14;
  const drops: [() => void, number][] = [
    [() => (parts.flows = false), 150],
    [() => (parts.battery = false), 150],
    [() => (parts.legend = false), 120],
    [() => (parts.weather = false), 110],
    [() => (marks = false), 90],
  ];
  for (const [drop, need] of drops) if (room - fixed() < need) drop();
  const plot = room - fixed();
  return plot < 72 ? null : { parts, marks, plot: Math.min(plot, 320), every: narrow ? 6 : 3 };
}

type Totals = NonNullable<ReturnType<typeof energyToday>>;

/**
 * Today's totals (kWh) from its readings, each held for the gap to the next one (at most 15 minutes, so an
 * outage doesn't count as power): for when the inverter's daily counters are missing or haven't started.
 */
function totalsOf(series: HistorySeries | undefined): Totals | null {
  if (!series?.t.length) return null;
  const t = { pv: 0, imp: 0, exp: 0, chg: 0, dis: 0, home: 0 };
  series.t.forEach((ts, i) => {
    const h = Math.min(900, (series.t[i + 1] ?? ts + 300) - ts) / 3600 / 1000; // W → kWh over the gap
    const g = series.grid_power?.[i] ?? 0;
    const b = series.battery_power?.[i] ?? 0; // + discharging
    t.pv += Math.max(0, series.pv_power?.[i] ?? 0) * h;
    t.home += Math.max(0, series.load_power?.[i] ?? 0) * h;
    t.imp += Math.max(0, g) * h;
    t.exp += Math.max(0, -g) * h;
    t.dis += Math.max(0, b) * h;
    t.chg += Math.max(0, -b) * h;
  });
  return t;
}

/**
 * Where the home's power came from today: the grid (what it imported), the battery (its discharge, up to what the
 * grid didn't cover), and straight from the panels (the rest). As History works out each day.
 */
const sources = homeSources;
type Sources = ReturnType<typeof sources>;

function Stat({ f, note }: { f: Fig; note: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-dim">
        <i className="size-1.5 flex-none rounded-full" style={{ background: f.color }} />
        <span className="truncate">{f.label}</span>
      </span>
      <span className="text-[28px] leading-[30px] font-light tracking-[-1px] whitespace-nowrap text-fg tabular-nums">
        {f.value}
        {f.unit && <small className="ml-1 text-[13px] font-normal tracking-normal text-ink-label">{f.unit}</small>}
      </span>
      {/* Always a line, empty or not, so the grid is the same height on every day. */}
      {note && <span className="truncate text-xs leading-4 text-ink-faint tabular-nums">{f.note || " "}</span>}
    </div>
  );
}

const energy = (v: number | null | undefined) => {
  if (v == null) return { value: "—" };
  const [value, unit] = energyParts(v);
  return { value, unit };
};

/**
 * Today at a glance on the Overview, and the next two days' forecast: step forward to see tomorrow and the day after
 * as the Plan page has them. Today shows its totals so far (live, from the inverter's daily counters or today's
 * readings) with what they should come to by midnight, where the home's power came from, and the Plan page's chart
 * of the day: recorded so far, forecast (dashed) for the rest, and on request the earlier forecast for the hours
 * gone, over what happened. A day ahead shows the same figures as forecast, with its Plan chart.
 *
 * Fitted to its size on the grid (`w` columns by `h` rows) rather than stretched to it: at its smallest (2 × 2) it's
 * the leading figure alone, then a row of figures, then (taller) the header with its arrows, a grid of the figures,
 * where the power came from and the chart, which gives up its bars, battery level, legend and weather in turn where
 * it has less height. At 8 columns and up the chart sits beside the figures. `show` leaves any of it out.
 */
export function TodayEnergyCard({
  p,
  s,
  f,
  now,
  prices,
  w = 12,
  h = 8,
  show = ALL,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  prices?: AmberPrices;
  /** Its size on the grid, in columns and rows. */
  w?: number;
  h?: number;
  show?: EnergyShow;
}) {
  const id = useId();
  const [stepped, setOffset] = useState(0);
  const [compare, setCompare] = useState(false);
  const start = midnight(now);
  const { data: history } = useQuery(FIELDS_KEY(start));
  const series = history?.series;
  const accuracy = useForecastAccuracy();
  const tariff = s?.tariff;
  const rates = useMemo(() => (tariff ? ratesFor(tariff, prices) : null), [tariff, prices]);
  const range = accuracy?.range ?? null;
  // The days as the Plan page works them out: today's rest of the day, then the days ahead.
  const days = useMemo(
    () =>
      f
        ? planDays(f, {
            now,
            snapshot: p,
            tariff,
            rates,
            todayCost: undefined,
            range,
            recorded: recordedBattery(series),
          })
        : [],
    [f, now, p, tariff, rates, range, series],
  );
  const today = days.find((d) => d.today);
  const ahead = days.filter((d) => !d.today);
  const { wide, tall, inner } = roomOf(w, h);
  const xs = wide === "xs";
  const header = tall !== "short" && !(xs && h < 4);
  const stepper = header && show.days && w >= 4;
  const offset = stepper ? Math.min(stepped, ahead.length) : 0;
  const day = offset > 0 ? ahead[offset - 1] : undefined;
  const title = day ? `${day.label}'s energy` : "Today's energy";

  const todays = useTodayFigures(p, series, today);
  const ahead1 = useMemo(() => day && aheadFigures(day), [day]);
  const { figs: all, from, home } = ahead1 ?? todays;
  const figs = [...all.filter((x) => x.key === show.lead), ...all.filter((x) => x.key !== show.lead)].filter((x) =>
    show.figures.includes(x.key),
  );
  const fig = show.notes ? FIGURE : FIGURE_BARE;
  const hasSources = show.sources && home > 0.05 && from != null;

  // What fits. Wide and tall enough, the chart sits beside the figures (and the header over them); otherwise it all
  // stacks, the figures first, then where the power came from, then the chart in what's left.
  const chartable = show.chart && w >= 4 && tall !== "short";
  const beside = chartable && wide === "lg" && chartFit(inner, show, false) != null;
  // where the power came from, beside a short wide row of figures
  const strip = tall === "short" && wide === "lg" && hasSources;
  const cols = beside
    ? 2
    : xs
      ? 1
      : tall === "short"
        ? Math.min(figs.length, strip ? (w >= 10 ? 4 : 3) : w <= 4 ? 2 : w <= 5 ? 3 : w <= 7 ? 4 : 6)
        : colsAt(w, 6);
  const need = Math.ceil(figs.length / Math.max(1, cols));
  let room = inner - (header ? HEAD : 0);
  let rows = 0;
  const fits = (px: number) => room - px >= 0;
  if (figs.length && fits(fig)) {
    rows = 1;
    room -= fig;
  }
  const withSources = hasSources && (strip || (tall !== "short" && !xs && fits(GAP + SOURCES)));
  if (withSources && !strip) room -= GAP + SOURCES;
  const links = show.links && tall === "tall" && !xs && fits(GAP + LINKS + (chartable && !beside ? 200 : 0));
  if (links) room -= GAP + LINKS;
  // more rows of figures, keeping a chart under them room enough to read
  const keep = chartable && !beside ? 220 : 0;
  while (tall !== "short" && rows < need && room - (GAP + fig) >= keep) {
    rows++;
    room -= GAP + fig;
  }
  // narrow, the chart leaves out its legend and marks every 6 hours rather than 3
  const chart = !chartable ? null : chartFit(beside ? inner : room - GAP, show, beside ? w < 10 : w < 8);
  const shown = figs.slice(0, rows * cols);

  const stepperEl = stepper && (
    <span className="flex flex-none items-center gap-1.5">
      <Button variant="icon" aria-label="Previous day" onClick={() => setOffset(offset - 1)} disabled={offset === 0}>
        <Icon name="chevL" size={18} />
      </Button>
      <Button
        variant="icon"
        aria-label={ahead[offset] ? `${ahead[offset].label}'s forecast` : "Next day"}
        onClick={() => setOffset(offset + 1)}
        disabled={offset >= ahead.length}
      >
        <Icon name="chevR" size={18} />
      </Button>
    </span>
  );
  const headerEl = !header ? (
    <span id={id} className="sr-only">
      {title}
    </span>
  ) : beside || (tall === "tall" && w >= 5) ? (
    // One line whatever the day's name: the title gives way (truncated) before it wraps.
    <CardHeader title={title} id={id} className="h-9 [&>h2]:min-w-0 [&>h2]:truncate" action={stepperEl} />
  ) : (
    <div className="flex h-9 min-w-0 items-center gap-3">
      <span id={id} className="min-w-0 flex-1 truncate font-display text-base font-bold">
        {title}
      </span>
      {stepperEl}
    </div>
  );
  const figsEl = shown.length > 0 && (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {shown.map((x) => (
        <Stat key={x.key} f={x} note={show.notes} />
      ))}
    </div>
  );
  const sourcesEl = withSources && from && <HomeSources from={from} home={home} ahead={!!day} />;
  const linksEl = links && (
    <div className="flex h-7 items-center justify-between gap-3 overflow-hidden whitespace-nowrap">
      {day ? (
        <ButtonLink to="/plan" search={{ day: offset }} variant="link" size="sm">
          {day.label}'s plan
        </ButtonLink>
      ) : (
        <ButtonLink to="/history" hash="day" variant="link" size="sm">
          Today in History
        </ButtonLink>
      )}
      {!day && today && chart && (
        <Button
          variant="chip"
          aria-pressed={compare}
          onClick={() => setCompare(!compare)}
          className={cn(compare && "border-ink/40 text-ink")}
        >
          {compare && <Icon name="check" size={12} />}
          Compare with forecast
        </Button>
      )}
    </div>
  );
  const chartEl = chart && (
    // the chart takes what's left, and never pushes the card taller than its rows
    <div className="relative min-h-0 min-w-0 flex-1">
      <div className="absolute inset-0 overflow-hidden">
        {day ? (
          <DayPlanChart key={day.key} day={day} s={s} now={now} rates={rates} range={range} fit={chart} />
        ) : today ? (
          <TodayPlanChart
            day={today}
            s={s}
            p={p}
            f={f}
            now={now}
            rates={rates}
            range={range}
            series={series}
            compare={compare}
            fit={chart}
          />
        ) : (
          <TodayChart now={now} series={series} f={f} />
        )}
      </div>
    </div>
  );

  return (
    <Card aria-labelledby={id} className="@container h-full gap-4 overflow-hidden p-5 max-sm:p-4">
      {beside && chartEl ? (
        <div className="flex min-h-0 flex-1 gap-8">
          <div className="flex w-[21rem] max-w-[40%] flex-none flex-col gap-4">
            {headerEl}
            {figsEl}
            {sourcesEl}
            {linksEl && <div className="mt-auto">{linksEl}</div>}
          </div>
          {chartEl}
        </div>
      ) : strip ? (
        <>
          {headerEl}
          <div className="flex min-w-0 items-start gap-8">
            <div className="min-w-0 flex-none basis-[55%]">{figsEl}</div>
            <div className="min-w-0 flex-1">{sourcesEl}</div>
          </div>
        </>
      ) : (
        <>
          {headerEl}
          {figsEl}
          {sourcesEl}
          {chartEl}
          {linksEl && <div className={cn(!chartEl && "mt-auto")}>{linksEl}</div>}
        </>
      )}
    </Card>
  );
}

const FIELDS_KEY = (start: number) =>
  historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true });

/**
 * Today's totals so far, with what they should come to by midnight (so far, plus the forecast for the hours left),
 * and where the home's power came from.
 */
function useTodayFigures(p: Snapshot | null, series: HistorySeries | undefined, plan: PlanDay | undefined) {
  const { peak } = useMemo(() => extremesOf(series), [series]);
  // The inverter's daily counters as History counts the day (the server keeps today's highest, so a dongle that
  // restarts and starts them over doesn't lose the morning), unless they're missing or at nothing while the readings
  // show a day under way (one that doesn't keep them): then today's readings added up.
  const counted = energyToday(p);
  const summed = useMemo(() => totalsOf(series), [series]);
  const e =
    counted && (!summed || counted.pv + counted.imp + counted.home > 0.05 || summed.pv + summed.imp + summed.home < 0.5)
      ? counted
      : summed;
  const from = e && sources(e);
  const [peakValue, peakUnit] = peak ? powerParts(peak.w) : ["—", ""];
  // Nothing to add once the day's forecast hours have run out.
  const rest = plan && plan.hours.length ? plan.day : null;
  const by = (so: number | undefined, more: number) =>
    rest && so != null ? `${kWh(so + more)} by midnight` : undefined;
  const figs: Fig[] = [
    { key: "solar", label: "Solar made", ...energy(e?.pv), color: COLOR.solar, note: by(e?.pv, rest?.pv_kwh ?? 0) },
    { key: "home", label: "Home use", ...energy(e?.home), color: COLOR.ink, note: by(e?.home, rest?.load_kwh ?? 0) },
    {
      key: "ss",
      label: "Self-sufficiency",
      value: from ? String(Math.round(from.ss * 100)) : "—",
      unit: from ? "%" : undefined,
      color: COLOR.good,
    },
    {
      key: "peak",
      label: "Peak solar",
      value: peakValue,
      unit: peak ? peakUnit : undefined,
      note: peak ? `at ${hhmm(peak.t)}` : undefined,
      color: COLOR.solar,
    },
    {
      key: "imp",
      label: "From the grid",
      ...energy(e?.imp),
      color: COLOR.fromGrid,
      note: by(e?.imp, rest?.import_kwh ?? 0),
    },
    {
      key: "exp",
      label: "Sent to the grid",
      ...energy(e?.exp),
      color: COLOR.export,
      note: by(e?.exp, rest?.export_kwh ?? 0),
    },
  ];
  return { figs, from: from as Sources | null, home: e?.home ?? 0 };
}

/**
 * Today's chart as History draws it, with the day's weather across the top (as recorded, then as forecast): for
 * when there's no forecast to plan the rest of the day with.
 */
function TodayChart({
  now,
  series,
  f,
}: {
  now: number;
  series: HistorySeries | undefined;
  f: Forecast | null | undefined;
}) {
  const start = midnight(now);
  const { data: weather } = useQuery(weatherDayQuery(dateKey(start)));
  const sky = useMemo(() => skyEvery3h(start, weather?.hours, f?.hours), [start, weather, f]);
  return (
    <DayChart series={series} placeholder={false} top={sky.some(Boolean) ? <WeatherRow sky={sky} /> : undefined} />
  );
}

/**
 * A day ahead's figures, as forecast: its totals, the solar peak (the sunniest hour), and where the home's power
 * should come from, hour by hour: solar first, then the battery, then the grid (as the forecast steps the
 * battery).
 */
function forecastTotals(day: PlanDay) {
  let solar = 0;
  let grid = 0;
  let home = 0;
  let peak = day.hours[0];
  for (const h of day.hours) {
    const use = hourKwh(h, h.load_kw);
    const direct = Math.min(h.pv_kwh, use);
    home += use;
    solar += direct;
    grid += Math.min(Math.max(0, h.grid_kwh), use - direct);
    if (h.pv_kw > (peak?.pv_kw ?? 0)) peak = h;
  }
  const battery = Math.max(0, home - solar - grid);
  return {
    e: { pv: day.pv, home, imp: day.imp, exp: day.exp },
    from: { solar, battery, grid, ss: home > 0 ? Math.max(0, 1 - grid / home) : 1 },
    peak: peak && peak.pv_kw >= 0.05 ? { w: peak.pv_kw * 1000, t: peak.ts + (hourEnd(peak) - peak.ts) / 2 } : null,
  };
}

/** A day ahead's forecast figures, laid out as today's are. */
function aheadFigures(day: PlanDay) {
  const { e, from, peak } = forecastTotals(day);
  const [peakValue, peakUnit] = peak ? powerParts(peak.w) : ["—", ""];
  const figs: Fig[] = [
    {
      key: "solar",
      label: "Solar forecast",
      ...energy(e.pv),
      color: COLOR.solar,
      note: day.pvRange ? `likely ${Math.round(day.pvRange[0])}–${kWh(day.pvRange[1])}` : undefined,
    },
    { key: "home", label: "Home use", ...energy(e.home), color: COLOR.ink },
    { key: "ss", label: "Self-sufficiency", value: String(Math.round(from.ss * 100)), unit: "%", color: COLOR.good },
    {
      key: "peak",
      label: "Peak solar",
      value: peakValue,
      unit: peak ? peakUnit : undefined,
      note: peak ? `around ${hhmm(peak.t)}` : undefined,
      color: COLOR.solar,
    },
    { key: "imp", label: "From the grid", ...energy(e.imp), color: COLOR.fromGrid },
    { key: "exp", label: "Sent to the grid", ...energy(e.exp), color: COLOR.export },
  ];
  return { figs, from: from as Sources | null, home: e.home };
}

type Fit = NonNullable<ReturnType<typeof chartFit>>;

/** A day ahead's chart, as the Plan page draws it, its key moments numbered across it. */
function DayPlanChart({
  day,
  s,
  now,
  rates,
  range,
  fit,
}: {
  day: PlanDay;
  s: SystemInfo | undefined;
  now: number;
  rates: ReturnType<typeof ratesFor> | null;
  range: { low: number; high: number } | null;
  fit: Fit;
}) {
  const reserve = reserveOf(s);
  const times = useMemo(() => bestTimes(day.hours, rates), [day, rates]);
  const events = useMemo(
    () => moments(day.hours, { now, end: addDays(day.start, 1), fullAt: day.battery.fullAt, reserve }),
    [day, now, reserve],
  );
  return (
    <PlanChart
      day={day}
      series={undefined}
      now={now}
      soc0={null}
      reserve={reserve}
      range={range ? [range.low, range.high] : null}
      windows={fit.marks ? [...times.spare, ...times.paid, ...times.avoid] : []}
      moments={fit.marks ? events : []}
      rates={rates}
      markerRow={fit.marks}
      parts={fit.parts}
      plot={fit.plot}
      every={fit.every}
    />
  );
}

/**
 * Today's chart, as the Plan page draws it: recorded so far, the forecast (dashed) for the rest, the weather and the
 * key moments. "Compare with forecast" (under the figures) adds, over the hours gone, what they were forecast to bring (dashed, as the forecast is): solar
 * from the day-ahead forecast kept with each hour's weather, home use from the typical day.
 */
function TodayPlanChart({
  day,
  s,
  p,
  f,
  now,
  rates,
  range,
  series,
  compare,
  fit,
}: {
  day: PlanDay;
  s: SystemInfo | undefined;
  p: Snapshot | null;
  f: Forecast | null | undefined;
  now: number;
  rates: ReturnType<typeof ratesFor> | null;
  range: { low: number; high: number } | null;
  series: HistorySeries | undefined;
  compare: boolean;
  fit: Fit;
}) {
  const reserve = reserveOf(s);
  const { data: weather } = useQuery(weatherDayQuery(dateKey(day.start)));
  const times = useMemo(() => bestTimes(day.hours, rates), [day, rates]);
  const events = useMemo(
    () => moments(day.hours, { now, end: addDays(day.start, 1), fullAt: day.battery.fullAt, reserve }),
    [day, now, reserve],
  );
  const overlay = useMemo((): Overlay | null => {
    if (!compare) return null;
    const pv = Array.from(
      { length: 24 },
      (_, k) => weather?.hours.find((h) => h.ts === day.start + k * 3600)?.pv_forecast ?? null,
    );
    return { pv, load: f?.load_basis?.profile_kw ?? [] };
  }, [compare, weather, f, day.start]);
  return (
    <PlanChart
      day={day}
      series={series}
      now={now}
      soc0={p?.battery_soc ?? null}
      reserve={reserve}
      range={range ? [range.low, range.high] : null}
      windows={fit.marks ? [...times.spare, ...times.paid, ...times.avoid] : []}
      moments={fit.marks ? events : []}
      rates={rates}
      recordedSky={weather?.hours}
      overlay={overlay}
      markerRow={fit.marks}
      parts={fit.parts}
      plot={fit.plot}
      every={fit.every}
    />
  );
}

/** The home's use over the day as one bar: from the panels, the battery and the grid. */
function HomeSources({ from, home, ahead }: { from: Sources; home: number; ahead?: boolean }) {
  const parts = [
    { key: "solar", label: "Solar", kwh: from.solar, color: COLOR.solar },
    { key: "battery", label: "Battery", kwh: from.battery, color: COLOR.battery },
    { key: "grid", label: "Grid", kwh: from.grid, color: COLOR.fromGrid },
  ].filter((x) => x.kwh >= 0.01);
  const total = home > 0 ? home : parts.reduce((a, x) => a + x.kwh, 0);
  return (
    <div className="@container flex min-w-0 flex-col gap-2.5">
      <span className="truncate text-xs leading-4 text-ink-dim">
        {ahead ? "Where your power should come from" : "Where your power came from"}
      </span>
      <div
        role="img"
        aria-label={parts.map((x) => `${x.label} ${Math.round((x.kwh / total) * 100)}%`).join(", ")}
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {parts.map((x) => (
          <span
            key={x.key}
            className="h-full origin-left animate-fill-x first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(x.kwh / total) * 100}%`, background: x.color }}
          />
        ))}
      </div>
      {/* one line: the kWh give way where it's narrow */}
      <div className="flex h-4 gap-x-4 overflow-hidden text-xs leading-4 whitespace-nowrap text-ink-label tabular-nums">
        {parts.map((x) => (
          <span key={x.key} className="flex items-center gap-1.5">
            <i className="size-2 flex-none rounded-full" style={{ background: x.color }} />
            {x.label} {Math.round((x.kwh / total) * 100)}%
            <span className="text-ink-faint @max-[22rem]:hidden">{kWh(x.kwh)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
