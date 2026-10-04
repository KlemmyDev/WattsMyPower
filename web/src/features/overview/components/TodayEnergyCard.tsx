import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { historyQuery } from "~/features/common/readings/api";
import type { Snapshot } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { energyToday } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { energyParts, kWh, powerParts } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { DayChart } from "~/features/history/components/DayChart";
import { extremesOf, hoursOf } from "~/features/history/utils/day";

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

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
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
    </div>
  );
}

const energy = (v: number | null | undefined) => {
  if (v == null) return { value: "—" };
  const [value, unit] = energyParts(v);
  return { value, unit };
};

/**
 * Today at a glance on the Overview: the day's totals so far (live, from the inverter's daily counters or today's
 * readings), where
 * the home's power came from, and the day's chart as History draws it, so today doesn't need a trip to History.
 */
export function TodayEnergyCard({ p, now }: { p: Snapshot | null; now: number }) {
  const start = midnight(now);
  const { data } = useQuery(historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }));
  const series = data?.series;
  const hours = useMemo(() => hoursOf(series, start), [series, start]);
  const { peak } = useMemo(() => extremesOf(series), [series]);
  // The inverter's daily counters, unless they're missing or still at nothing while the readings show a day
  // under way (a dongle that's restarted, or one that doesn't keep them): then today's readings added up.
  const counted = energyToday(p);
  const summed = useMemo(() => totalsOf(series), [series]);
  const e =
    counted && (!summed || counted.pv + counted.imp + counted.home >= 0.5 * (summed.pv + summed.imp + summed.home))
      ? counted
      : summed;
  const from = e && sources(e);
  const [peakValue, peakUnit] = peak ? powerParts(peak.w) : ["—", ""];
  return (
    <Card
      aria-labelledby="h-today-energy"
      className="col-span-12 grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-10 max-lg:grid-cols-1 max-lg:gap-6"
    >
      <div className="flex flex-col gap-6">
        <CardHeader
          title="Today's energy"
          id="h-today-energy"
          action={
            <ButtonLink to="/history" variant="chip">
              History
            </ButtonLink>
          }
        />
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Stat label="Solar made" {...energy(e?.pv)} color={COLOR.solar} />
          <Stat label="Home use" {...energy(e?.home)} color={COLOR.ink} />
          <Stat
            label="Self-sufficiency"
            value={from ? String(Math.round(from.ss * 100)) : "—"}
            unit={from ? "%" : undefined}
            color={COLOR.good}
          />
          <Stat
            label="Peak solar"
            value={peakValue}
            unit={peak ? `${peakUnit} at ${hhmm(peak.t)}` : undefined}
            color={COLOR.solar}
          />
          <Stat label="From the grid" {...energy(e?.imp)} color={COLOR.fromGrid} />
          <Stat label="Sent to the grid" {...energy(e?.exp)} color={COLOR.export} />
        </div>
        {e && from && e.home > 0.05 && <HomeSources from={from} home={e.home} />}
      </div>
      <div className="flex min-w-0 flex-col justify-end">
        <DayChart series={series} hours={hours} placeholder={false} />
      </div>
    </Card>
  );
}

/** The home's use today as one bar: from the panels, the battery and the grid. */
function HomeSources({ from, home }: { from: ReturnType<typeof sources>; home: number }) {
  const parts = [
    { key: "solar", label: "Solar", kwh: from.solar, color: COLOR.solar },
    { key: "battery", label: "Battery", kwh: from.battery, color: COLOR.battery },
    { key: "grid", label: "Grid", kwh: from.grid, color: COLOR.fromGrid },
  ].filter((x) => x.kwh >= 0.01);
  const total = parts.reduce((a, x) => a + x.kwh, 0) || home;
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs text-ink-dim">Where the home's power came from</span>
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
