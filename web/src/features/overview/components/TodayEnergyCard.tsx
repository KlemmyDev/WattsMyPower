import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { AmberPrices } from "~/features/amber/types";
import { historyQuery } from "~/features/common/readings/api";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import type { Forecast } from "~/features/common/weather/types";
import { energyToday, reserveOf } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { energyParts, kWh, powerParts } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { useForecastAccuracy } from "~/features/common/weather/hooks";
import { DayChart } from "~/features/history/components/DayChart";
import { extremesOf } from "~/features/history/utils/day";
import { PlanChart, type Overlay } from "~/features/plan/components/PlanChart";
import { skyEvery3h, WeatherRow } from "~/features/plan/components/WeatherRow";
import { weatherDayQuery } from "~/features/weather/api";
import { bestTimes, hourEnd, hourKwh, planDays, recordedBattery, type PlanDay } from "~/features/plan/utils";
import { moments } from "~/features/plan/utils/moments";
import { ratesFor } from "~/features/plan/utils/rates";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc", "battery_power"];

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
function sources(e: Totals) {
  const covered = Math.max(0, e.home - e.imp);
  const battery = Math.min(covered, e.dis);
  return { solar: covered - battery, battery, grid: Math.min(e.imp, e.home), ss: e.home > 0 ? covered / e.home : 0 };
}

function Stat({
  label,
  value,
  unit,
  color,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
  /** A line under the figure: what today should come to by midnight, a forecast's likely range, the peak's time. */
  note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-ink-dim">
        <i className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-[28px] leading-[30px] font-light tracking-[-1px] text-fg tabular-nums">
        {value}
        {unit && <small className="ml-1 text-[13px] font-normal tracking-normal text-ink-label">{unit}</small>}
      </span>
      {/* Always a line, empty or not, so the grid is the same height on every day. */}
      <span className="truncate text-xs leading-4 text-ink-faint tabular-nums">{note || "\u00a0"}</span>
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
 */
export function TodayEnergyCard({
  p,
  s,
  f,
  now,
  prices,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  prices?: AmberPrices;
}) {
  const [offset, setOffset] = useState(0);
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
  const day = offset > 0 ? ahead[offset - 1] : undefined;
  const last = ahead.length;
  const title = day ? `${day.label}'s energy` : "Today's energy";

  return (
    <Card
      aria-labelledby="h-today-energy"
      className="col-span-12 grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-10 max-lg:grid-cols-1 max-lg:gap-6"
    >
      <div className="flex flex-col gap-6">
        {/* One line whatever the day's name: the title gives way (truncated) before it wraps. */}
        <CardHeader
          title={title}
          id="h-today-energy"
          className="[&>h2]:min-w-0 [&>h2]:truncate"
          action={
            <span className="flex flex-none items-center gap-1.5">
              <Button
                variant="icon"
                aria-label="Previous day"
                onClick={() => setOffset((o) => o - 1)}
                disabled={offset === 0}
              >
                <Icon name="chevL" size={18} />
              </Button>
              <Button
                variant="icon"
                aria-label={ahead[offset] ? `${ahead[offset].label}'s forecast` : "Next day"}
                onClick={() => setOffset((o) => o + 1)}
                disabled={offset >= last}
              >
                <Icon name="chevR" size={18} />
              </Button>
            </span>
          }
        />
        {day ? <AheadStats day={day} /> : <TodayStats p={p} series={series} plan={today} />}
        <div className="mt-auto flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {day ? (
            <ButtonLink to="/plan" search={{ day: offset }} variant="link" size="sm">
              {day.label}'s plan
            </ButtonLink>
          ) : (
            <ButtonLink to="/history" hash="day" variant="link" size="sm">
              Today in History
            </ButtonLink>
          )}
          {!day && today && (
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
      </div>
      <div className="flex min-w-0 flex-col justify-end gap-5">
        {day ? (
          <DayPlanChart key={day.key} day={day} s={s} now={now} rates={rates} range={range} />
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
          />
        ) : (
          <TodayChart now={now} series={series} f={f} />
        )}
      </div>
    </Card>
  );
}

const FIELDS_KEY = (start: number) =>
  historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true });

/**
 * Today's totals so far, with what they should come to by midnight (so far, plus the forecast for the hours left),
 * and where the home's power came from.
 */
function TodayStats({
  p,
  series,
  plan,
}: {
  p: Snapshot | null;
  series: HistorySeries | undefined;
  plan: PlanDay | undefined;
}) {
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
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Stat label="Solar made" {...energy(e?.pv)} color={COLOR.solar} note={by(e?.pv, rest?.pv_kwh ?? 0)} />
        <Stat
          label="Home use"
          {...energy(e?.home)}
          color={COLOR.ink}
          note={by(e?.home, (rest?.load_kwh ?? 0) + (rest?.car_kwh ?? 0))}
        />
        <Stat
          label="Self-sufficiency"
          value={from ? String(Math.round(from.ss * 100)) : "—"}
          unit={from ? "%" : undefined}
          color={COLOR.good}
        />
        <Stat
          label="Peak solar"
          value={peakValue}
          unit={peak ? peakUnit : undefined}
          note={peak ? `at ${hhmm(peak.t)}` : undefined}
          color={COLOR.solar}
        />
        <Stat
          label="From the grid"
          {...energy(e?.imp)}
          color={COLOR.fromGrid}
          note={by(e?.imp, rest?.import_kwh ?? 0)}
        />
        <Stat
          label="Sent to the grid"
          {...energy(e?.exp)}
          color={COLOR.export}
          note={by(e?.exp, rest?.export_kwh ?? 0)}
        />
      </div>
      {e && from && e.home > 0.05 && <HomeSources from={from} home={e.home} />}
    </>
  );
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
    const use = hourKwh(h, h.load_kw + (h.car_kw ?? 0));
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
function AheadStats({ day }: { day: PlanDay }) {
  const { e, from, peak } = useMemo(() => forecastTotals(day), [day]);
  const [peakValue, peakUnit] = peak ? powerParts(peak.w) : ["—", ""];
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Stat
          label="Solar forecast"
          {...energy(e.pv)}
          color={COLOR.solar}
          note={day.pvRange ? `likely ${Math.round(day.pvRange[0])}–${kWh(day.pvRange[1])}` : undefined}
        />
        <Stat label="Home use" {...energy(e.home)} color={COLOR.ink} />
        <Stat label="Self-sufficiency" value={String(Math.round(from.ss * 100))} unit="%" color={COLOR.good} />
        <Stat
          label="Peak solar"
          value={peakValue}
          unit={peak ? peakUnit : undefined}
          note={peak ? `around ${hhmm(peak.t)}` : undefined}
          color={COLOR.solar}
        />
        <Stat label="From the grid" {...energy(e.imp)} color={COLOR.fromGrid} />
        <Stat label="Sent to the grid" {...energy(e.exp)} color={COLOR.export} />
      </div>
      {e.home > 0.05 && <HomeSources from={from} home={e.home} ahead />}
    </>
  );
}

/** A day ahead's chart, as the Plan page draws it, its key moments numbered across it. */
function DayPlanChart({
  day,
  s,
  now,
  rates,
  range,
}: {
  day: PlanDay;
  s: SystemInfo | undefined;
  now: number;
  rates: ReturnType<typeof ratesFor> | null;
  range: { low: number; high: number } | null;
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
      windows={[...times.spare, ...times.paid, ...times.avoid]}
      moments={events}
      rates={rates}
      markerRow
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
      windows={[...times.spare, ...times.paid, ...times.avoid]}
      moments={events}
      rates={rates}
      recordedSky={weather?.hours}
      overlay={overlay}
      markerRow
    />
  );
}

/** The home's use over the day as one bar: from the panels, the battery and the grid. */
function HomeSources({ from, home, ahead }: { from: ReturnType<typeof sources>; home: number; ahead?: boolean }) {
  const parts = [
    { key: "solar", label: "Solar", kwh: from.solar, color: COLOR.solar },
    { key: "battery", label: "Battery", kwh: from.battery, color: COLOR.battery },
    { key: "grid", label: "Grid", kwh: from.grid, color: COLOR.fromGrid },
  ].filter((x) => x.kwh >= 0.01);
  const total = parts.reduce((a, x) => a + x.kwh, 0) || home;
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs text-ink-dim">
        {ahead ? "Where the home's power should come from" : "Where the home's power came from"}
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-label tabular-nums">
        {parts.map((x) => (
          <span key={x.key} className="flex items-center gap-1.5">
            <i className="size-2 flex-none rounded-full" style={{ background: x.color }} />
            {x.label} {Math.round((x.kwh / total) * 100)}%<span className="text-ink-faint">{kWh(x.kwh)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
