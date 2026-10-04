import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { priceLabel } from "~/features/amber/utils";
import type { HistorySeries } from "~/features/common/readings/types";
import type { ForecastHour } from "~/features/common/weather/types";
import { ChartTooltip, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import { addDays } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { degrees, hourIcon, hourIconColor } from "~/features/common/weather/utils";
import type { WeatherHour } from "~/features/weather/types";
import { hoursOf } from "~/features/history/utils/day";
import { FLOW_COLOR, FlowBars } from "~/features/history/components/FlowBars";
import { MARKER_ROW, MomentMarkers } from "~/features/plan/components/Moments";
import { skyEvery3h, WeatherRow } from "~/features/plan/components/WeatherRow";
import { hourEnd, hourKwh, type PlanDay, type Window } from "~/features/plan/utils";
import type { Moment } from "~/features/plan/utils/moments";
import type { Rates } from "~/features/plan/utils/rates";

const W = 1000;
const PH = 200; // solar and home use
const BH = 64; // battery level

/** One hour of the day as the chart reads it: recorded (today, before now) or forecast. */
type Row = {
  t0: number;
  t1: number;
  pv: number | null;
  load: number | null;
  grid: number | null; // kWh, + from the grid
  bat: number | null; // kWh, + discharging
  soc: number | null;
  /** Planned car charging (kWh), forecast hours only; the inverter's readings count it in home use. */
  car: number | null;
  h: ForecastHour | null;
};
type P = { t: number; v: number };
/**
 * What today's hours were forecast to bring, hour by hour from midnight (kW, or kWh in the hour): solar, from the
 * day-ahead forecast kept with each hour's weather, and home use, the typical day's. Drawn over the hours already
 * gone, to set against what actually happened.
 */
export type Overlay = { pv: (number | null)[]; load: (number | null)[] };

const STROKE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

function plot(
  day: PlanDay,
  series: HistorySeries | undefined,
  now: number,
  soc0: number | null,
  range: [number, number] | null,
  recordedSky: WeatherHour[] | undefined,
  overlay: Overlay | null,
) {
  const start = day.start;
  const span = addDays(start, 1) - start;
  const from = day.today ? now : start;
  const X = (t: number) => ((Math.min(start + span, Math.max(start, t)) - start) / span) * W;

  // Hour by hour: recorded hours from the readings, the rest from the forecast.
  const recorded = day.today ? hoursOf(series, start) : [];
  const rows: Row[] = [];
  for (let t0 = start, i = 0; t0 < start + span; t0 += 3600, i++) {
    const t1 = t0 + 3600;
    const h = day.hours.find((x) => x.ts === t0) ?? null;
    if (day.today && t1 <= now) {
      const r = recorded[i];
      rows.push({
        t0,
        t1,
        pv: r?.pv ?? null,
        load: r?.load ?? null,
        grid: r?.grid ?? null,
        bat: r?.bat ?? null,
        soc: r?.soc ?? null,
        car: null,
        h: null,
      });
    } else if (h) {
      rows.push({
        t0: h.start,
        t1,
        pv: h.pv_kwh,
        load: hourKwh(h, h.load_kw),
        grid: h.grid_kwh,
        // What the battery gave (+) or took: what the house and car used, less solar and the grid.
        bat: hourKwh(h, h.load_kw + (h.car_kw ?? 0)) - h.pv_kwh - h.grid_kwh,
        soc: h.soc,
        car: hourKwh(h, h.car_kw ?? 0),
        h,
      });
    } else rows.push({ t0, t1, pv: null, load: null, grid: null, bat: null, soc: null, car: null, h: null });
  }

  // Recorded lines from the 5-minute readings before now.
  const past = (field: string, scale: number): P[] =>
    !day.today || !series
      ? []
      : series.t.flatMap((t, i) => {
          const v = series[field]?.[i];
          return t < now && v != null ? [{ t, v: Math.max(0, v) * scale }] : [];
        });
  const pvPast = past("pv_power", 0.001);
  const loadPast = past("load_power", 0.001);
  const socPast = past("battery_soc", 1);

  // Forecast lines: hourly averages drawn through the middle of each hour, from `from` to midnight.
  const hrs = day.hours;
  const mid = (h: ForecastHour) => h.start + (hourEnd(h) - h.start) / 2;
  const ahead = (k: "pv_kw" | "load_kw" | "car_kw"): P[] =>
    hrs.length
      ? [
          { t: from, v: hrs[0][k] },
          ...hrs.map((h) => ({ t: mid(h), v: h[k] })),
          { t: start + span, v: hrs[hrs.length - 1][k] },
        ]
      : [];
  const pvAhead = ahead("pv_kw");
  const loadAhead = ahead("load_kw");
  // Planned car charging, drawn only on a day with some.
  const carAhead = hrs.some((h) => (h.car_kw ?? 0) > 0) ? ahead("car_kw") : [];
  // The earlier forecast for the hours gone, through the middle of each.
  const before = (vals: (number | null)[] | undefined): P[] =>
    !day.today || !vals
      ? []
      : vals.flatMap((v, k) => {
          const t = start + k * 3600 + 1800;
          return v != null && t <= now ? [{ t, v }] : [];
        });
  const pvWas = before(overlay?.pv);
  const loadWas = before(overlay?.load);
  const socAhead: P[] = hrs.length
    ? [{ t: from, v: soc0 ?? hrs[0].soc }, ...hrs.map((h) => ({ t: Math.min(start + span, hourEnd(h)), v: h.soc }))]
    : [];

  const top = Math.max(
    1,
    ...[...pvPast, ...loadPast, ...loadAhead, ...carAhead, ...pvWas, ...loadWas].map((p) => p.v),
    ...pvAhead.map((p) => p.v * (range ? range[1] : 1)),
  );
  const mx = top * 1.1;
  const py = (v: number) => PH - 2 - (v / mx) * (PH - 10);
  const by = (v: number) => BH - 2 - (v / 100) * (BH - 4);
  const path = (pts: P[], fy: (v: number) => number) =>
    pts.map((p, k) => `${k ? "L" : "M"}${X(p.t).toFixed(1)} ${fy(p.v).toFixed(1)}`).join(" ");
  const area = (pts: P[]) =>
    pts.length
      ? `${path(pts, py)} L${X(pts[pts.length - 1].t).toFixed(1)} ${PH - 2} L${X(pts[0].t).toFixed(1)} ${PH - 2} Z`
      : "";
  const band =
    range && pvAhead.length
      ? `${path(
          pvAhead.map((p) => ({ t: p.t, v: p.v * range[1] })),
          py,
        )} ${[...pvAhead]
          .reverse()
          .map((p) => `L${X(p.t).toFixed(1)} ${py(p.v * range[0]).toFixed(1)}`)
          .join(" ")} Z`
      : "";

  // The weather every three hours: the forecast's, or (earlier today) what was recorded.
  const sky = skyEvery3h(start, day.hours, recordedSky);

  return {
    start,
    span,
    rows,
    sky,
    X,
    nowX: day.today ? X(now) : null,
    pvPast: path(pvPast, py),
    pvPastArea: area(pvPast),
    loadPast: path(loadPast, py),
    socPast: path(socPast, by),
    pvAhead: path(pvAhead, py),
    pvAheadArea: area(pvAhead),
    loadAhead: path(loadAhead, py),
    carAhead: path(carAhead, py),
    socAhead: path(socAhead, by),
    pvWas: path(pvWas, py),
    loadWas: path(loadWas, py),
    band,
    by,
  };
}

const WINDOW_COLOR: Record<Window["kind"], string> = { spare: COLOR.export, avoid: COLOR.bad, paid: COLOR.good };

function RowTooltip({
  row,
  left,
  width,
  rates,
  marked,
  was,
}: {
  row: Row;
  left: number;
  width: number;
  rates: Rates | null;
  /** A recorded hour's earlier forecast (kWh), with the overlay on. */
  was: { pv: number | null; load: number | null } | null;
  /** Below the moments' row of numbers (MARKER_ROW). */
  marked: boolean;
}) {
  const fahrenheit = useFahrenheit();
  const h = row.h;
  const icon = h ? hourIcon(h) : null;
  const g = row.grid ?? 0;
  // What the hour's grid power is priced at: feed-in while it exports, the buy price otherwise.
  const selling = g <= -0.05;
  const price = h && rates ? (selling ? rates.sell : rates.buy)(h.start, hourEnd(h)) : null;
  const name = selling ? "Feed-in" : h && rates ? (rates.name(h.start, hourEnd(h)) ?? "Grid price") : null;
  return (
    <ChartTooltip left={left} flip={left > 60} width={width} className={marked ? "top-[48px]" : "top-[22px]"}>
      <div className="flex items-end justify-between gap-2 font-medium text-ink">
        <span className="flex flex-col">
          <span className="text-[11px] font-normal text-ink-faint">{h ? "Forecast" : "Recorded"}</span>
          {hhmm(row.t0)} to {hhmm(row.t1)}
        </span>
        {icon && h && (
          <span className="flex items-center gap-1 text-ink-soft">
            <span style={{ color: hourIconColor(icon) }}>
              <Icon name={icon} size={14} />
            </span>
            {h.temp != null ? degrees(h.temp, fahrenheit) : ""}
          </span>
        )}
      </div>
      <TooltipRow label="Solar" value={kWh(row.pv)} color={COLOR.solar} />
      {was?.pv != null && <TooltipRow label="Forecast solar" value={kWh(was.pv)} />}
      <TooltipRow label="Home use" value={kWh(row.load)} color={COLOR.ink} />
      {was?.load != null && <TooltipRow label="Typical home use" value={kWh(was.load)} />}
      {row.car != null && row.car >= 0.05 && (
        <TooltipRow label="Car charging" value={kWh(row.car)} color={COLOR.lilac} />
      )}
      <TooltipRow label="Battery" value={row.soc == null ? DASH : pct(row.soc)} color={COLOR.battery} />
      {row.bat != null && Math.abs(row.bat) >= 0.05 && (
        <TooltipRow label={row.bat > 0 ? "Discharged" : "Charged"} value={kWh(Math.abs(row.bat))} />
      )}
      <TooltipRow
        label={g >= 0.05 ? "From the grid" : g <= -0.05 ? "To the grid" : "Grid"}
        value={row.grid == null ? DASH : Math.abs(g) >= 0.05 ? kWh(Math.abs(g)) : "Idle"}
      />
      {price != null && <TooltipRow label={name} value={`${priceLabel(price)}/kWh`} />}
    </ChartTooltip>
  );
}

/**
 * A day of the plan, midnight to midnight: solar and home use, the battery level, and grid power
 * hour by hour. Today shows what's been recorded up to now and the forecast after it; solar's
 * likely range is shaded around its forecast, and the day's best times are marked across the top, with its key
 * moments numbered above them.
 */
export function PlanChart({
  day,
  series,
  now,
  soc0,
  reserve,
  range,
  windows,
  moments,
  rates,
  recordedSky,
  overlay = null,
  legendExtra,
  markerRow = false,
}: {
  day: PlanDay;
  series: HistorySeries | undefined;
  now: number;
  soc0: number | null;
  reserve: number;
  range: [number, number] | null;
  windows: Window[];
  moments: Moment[];
  rates: Rates | null;
  /** Today's weather as recorded, for the hours already gone (the forecast has the rest). */
  recordedSky?: WeatherHour[];
  /** Today: the earlier forecast for the hours gone, drawn over what happened (see Overlay). */
  overlay?: Overlay | null;
  /** Something at the end of the legend's row. */
  legendExtra?: ReactNode;
  /** Keep the row for the moments' numbers even on a day with none, so charts side by side (or one after another, as
   * the Overview steps through days) stay the same height. */
  markerRow?: boolean;
}) {
  const c = useMemo(
    () => plot(day, series, now, soc0, range, recordedSky, overlay),
    [day, series, now, soc0, range, recordedSky, overlay],
  );
  const [hover, setHover] = useState<Row | null>(null);
  const [width, setWidth] = useState(0);
  const left = (t: number) => (c.X(t) / W) * 100;
  // The moments' numbers sit in a row of their own above the best-times strips.
  const top = moments.length || markerRow ? MARKER_ROW : 0;

  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth); // layout px, as the tooltip is placed in (r is zoomed with the page)
    const t = c.start + Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * c.span;
    setHover(c.rows.find((row) => row.t0 <= t && t < row.t1) ?? null);
  };

  const legend: [string, string, "line" | "dash" | "box"][] = [
    ["Solar", COLOR.solar, "line"],
    ["Home use", COLOR.ink, "line"],
    ["Battery level", COLOR.battery, "line"],
    ["From grid", COLOR.fromGrid, "box"],
    ["Sent to grid", COLOR.export, "box"],
    ["Battery in and out", FLOW_COLOR.battery, "box"],
    ...(c.carAhead ? [["Car charging", COLOR.lilac, "line"] as [string, string, "line"]] : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-dim">
        {legend.map(([label, color, kind]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i
              className={kind === "box" ? "size-2.5 rounded-[2px]" : "h-[3px] w-3.5 rounded-[2px]"}
              style={{ background: color }}
            />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <i className="w-3.5 border-t-2 border-dashed border-ink-faint" />
          Forecast
        </span>
        {c.band && (
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-[2px]" style={{ background: alpha(COLOR.solar, 0.22) }} />
            Likely solar range
          </span>
        )}
        {(c.pvWas || c.loadWas) && (
          <span className="flex items-center gap-1.5">
            <i className="w-3.5 border-t-2 border-dotted border-ink-muted" />
            Forecast earlier
          </span>
        )}
        {legendExtra && <span className="ml-auto flex items-center">{legendExtra}</span>}
      </div>
      <WeatherRow sky={c.sky} />
      <div
        className="relative flex cursor-crosshair touch-pan-y flex-col gap-1.5"
        style={{ paddingTop: top + 22 }}
        onPointerMove={onPoint}
        onPointerDown={onPoint}
        onPointerLeave={() => setHover(null)}
      >
        {/* The day's best times, as labelled strips across the top and a faint wash behind the plots. */}
        {windows.map((w) => (
          <div
            key={`${w.kind}${w.start}`}
            aria-hidden
            className="pointer-events-none absolute bottom-0"
            style={{ top, left: `${left(w.start)}%`, width: `${left(w.end) - left(w.start)}%` }}
          >
            <div className="h-1.5 rounded-full" style={{ background: WINDOW_COLOR[w.kind] }} />
            <div
              className="absolute inset-x-0 top-[22px] bottom-0 rounded-md"
              style={{ background: alpha(WINDOW_COLOR[w.kind], 0.07) }}
            />
          </div>
        ))}
        {c.nowX != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0"
            style={{ top: top + 10, left: `${(c.nowX / W) * 100}%` }}
          >
            <span className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink px-1.5 text-[10px] leading-4 font-semibold text-ink-inverse">
              Now
            </span>
            <span className="absolute top-2 bottom-0 left-0 border-l border-dashed border-line-strong" />
          </div>
        )}
        <MomentMarkers moments={moments} left={left} />
        {hover && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 rounded-[3px] bg-fg/8"
            style={{ top: top + 22, left: `${left(hover.t0)}%`, width: `${left(hover.t1) - left(hover.t0)}%` }}
          />
        )}
        <div className="relative h-[200px] max-sm:h-[160px] compact:h-[140px]">
          {["0%", "33%", "66%"].map((top) => (
            <div key={top} className="absolute right-0 left-0 border-t border-fg/5" style={{ top }} />
          ))}
          <svg
            viewBox={`0 0 ${W} ${PH}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-0 size-full animate-reveal-x overflow-visible"
          >
            {c.band && <path d={c.band} style={{ fill: alpha(COLOR.solar, 0.16) }} />}
            {c.pvPastArea && <path d={c.pvPastArea} style={{ fill: alpha(COLOR.solarWash, 0.32) }} />}
            {c.pvAheadArea && <path d={c.pvAheadArea} style={{ fill: alpha(COLOR.solarWash, 0.16) }} />}
            <path d={c.pvPast} {...STROKE} strokeWidth="2" style={{ stroke: COLOR.solar }} />
            <path d={c.pvAhead} {...STROKE} strokeWidth="2" strokeDasharray="6 5" style={{ stroke: COLOR.solar }} />
            <path d={c.loadPast} {...STROKE} strokeWidth="1.5" style={{ stroke: COLOR.ink }} />
            {c.pvWas && (
              <path
                d={c.pvWas}
                {...STROKE}
                strokeWidth="2"
                strokeDasharray="1 4"
                style={{ stroke: alpha(COLOR.solar, 0.85) }}
              />
            )}
            {c.loadWas && (
              <path
                d={c.loadWas}
                {...STROKE}
                strokeWidth="1.75"
                strokeDasharray="1 4"
                style={{ stroke: alpha(COLOR.ink, 0.6) }}
              />
            )}
            <path d={c.loadAhead} {...STROKE} strokeWidth="1.5" strokeDasharray="6 5" style={{ stroke: COLOR.ink }} />
            {c.carAhead && (
              <path d={c.carAhead} {...STROKE} strokeWidth="2" strokeDasharray="6 5" style={{ stroke: COLOR.lilac }} />
            )}
            <line
              x1="0"
              x2={W}
              y1={PH - 2}
              y2={PH - 2}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.12) }}
            />
          </svg>
        </div>
        <div className="mt-1 flex items-center justify-end text-[11px] text-ink-dim tabular-nums">
          Reserve {reserve}%
        </div>
        <div className="relative h-16 compact:h-12">
          <svg
            viewBox={`0 0 ${W} ${BH}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-0 size-full animate-reveal-x overflow-visible"
          >
            <line
              x1="0"
              x2={W}
              y1={c.by(100)}
              y2={c.by(100)}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.08) }}
            />
            <line
              x1="0"
              x2={W}
              y1={c.by(reserve)}
              y2={c.by(reserve)}
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.3) }}
            />
            <path d={c.socPast} {...STROKE} strokeWidth="2.25" style={{ stroke: COLOR.battery }} />
            <path
              d={c.socAhead}
              {...STROKE}
              strokeWidth="2.25"
              strokeDasharray="6 5"
              style={{ stroke: COLOR.battery }}
            />
            <line
              x1="0"
              x2={W}
              y1={BH - 2}
              y2={BH - 2}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.12) }}
            />
          </svg>
        </div>
        <FlowBars
          hours={c.rows.map((r) => ({ grid: r.grid, bat: r.bat, forecast: !!r.h }))}
          className="relative mt-1 h-[64px] compact:h-12"
        />
        {hover && (
          <RowTooltip
            row={hover}
            left={left(hover.t0 + (hover.t1 - hover.t0) / 2)}
            width={width}
            rates={rates}
            marked={top > 0}
            was={
              overlay && !hover.h && day.today
                ? {
                    pv: overlay.pv[Math.round((hover.t0 - c.start) / 3600)] ?? null,
                    load: overlay.load[Math.round((hover.t0 - c.start) / 3600)] ?? null,
                  }
                : null
            }
          />
        )}
      </div>
      <div className="relative h-3.5">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h, i, all) => (
          <span
            key={h}
            className={cn(
              "absolute font-mono text-[11px] text-ink-faint",
              i === 0 ? "" : i === all.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
              i % 2 === 1 && "max-md:hidden",
            )}
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {hourLabel(h)}
          </span>
        ))}
      </div>
    </div>
  );
}
