import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { priceLabel } from "~/features/amber/utils";
import type { HistorySeries } from "~/features/common/readings/types";
import type { ForecastHour } from "~/features/common/weather/types";
import { ChartTooltip, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, pct } from "~/features/common/formatting/utils/number";
import { addDays } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { degrees, hourIcon, hourIconColor } from "~/features/common/weather/utils";
import type { WeatherHour } from "~/features/weather/types";
import { HALF_HOUR, slotsOf } from "~/features/history/utils/day";
import { FLOW_COLOR, FlowBars, type Flow } from "~/features/history/components/FlowBars";
import { MARKER_ROW, MomentMarkers } from "~/features/plan/components/Moments";
import { skyEvery3h, WeatherRow } from "~/features/plan/components/WeatherRow";
import { hourEnd, hourKwh, type PlanDay, type Window } from "~/features/plan/utils";
import type { Moment } from "~/features/plan/utils/moments";
import type { Rates } from "~/features/plan/utils/rates";

const W = 1000;
const PH = 200; // solar and home use
const BH = 64; // battery level

type P = { t: number; v: number };
/** Five minutes under the pointer, as History reads one out: power in W (+ from the grid, + battery discharging), the
 * battery level, and where each sits on its plot (percentages of its height) for the dots. */
type Point = {
  t: number;
  recorded: boolean;
  pv: number | null;
  load: number | null;
  grid: number | null;
  bat: number | null;
  soc: number | null;
  car: number | null;
  /** The forecast hour it falls in; null for a recorded one. */
  h: ForecastHour | null;
  pvTop: number | null;
  loadTop: number | null;
  socTop: number | null;
};
/** The hover's step: one reading. */
const STEP = 300;
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

  // The grid and battery bars, a half hour each: those gone (today) from the readings, the rest from the forecast.
  // The forecast is hourly, so each hour is shared over its halves (the part of one it covers, for the half hour under
  // way). The battery's share is what the house and car used, less solar and the grid (+ discharging).
  const recorded = day.today ? slotsOf(series, start, HALF_HOUR) : [];
  const flows: Flow[] = [];
  for (let t0 = start, i = 0; t0 < start + span; t0 += HALF_HOUR, i++) {
    const t1 = t0 + HALF_HOUR;
    const h = day.hours.find((x) => x.ts <= t0 && t0 < x.ts + 3600);
    if (day.today && t1 <= now) flows.push({ grid: recorded[i]?.grid ?? null, bat: recorded[i]?.bat ?? null });
    else if (h) {
      const share = Math.max(0, Math.min(t1, hourEnd(h)) - Math.max(t0, h.start)) / Math.max(1, hourEnd(h) - h.start);
      const bat = hourKwh(h, h.load_kw + (h.car_kw ?? 0)) - h.pv_kwh - h.grid_kwh;
      flows.push({ grid: h.grid_kwh * share, bat: bat * share, forecast: true });
    } else flows.push({ grid: null, bat: null });
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

  // The five minutes from `t`: the reading itself for those gone today, else read off the forecast lines (solar, home
  // use, battery level) with the grid and battery at their hour's average, the forecast being hourly.
  const lerp = (pts: P[], t: number): number | null => {
    if (!pts.length) return null;
    const k = pts.findIndex((p) => p.t >= t);
    if (k <= 0) return k === 0 ? pts[0].v : pts[pts.length - 1].v;
    const a = pts[k - 1];
    const b = pts[k];
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1);
  };
  const at = new Map((day.today ? series?.t : undefined)?.map((t, i) => [t, i]) ?? []);
  const pct = (v: number | null, f: (v: number) => number, h: number) => (v == null ? null : (f(v) / h) * 100);
  const point = (t: number): Point => {
    let p: Omit<Point, "pvTop" | "loadTop" | "socTop">;
    if (day.today && t < now) {
      const i = at.get(t);
      const v = (f: string) => (i == null ? null : (series?.[f]?.[i] ?? null));
      p = {
        t,
        recorded: true,
        pv: v("pv_power"),
        load: v("load_power"),
        grid: v("grid_power"),
        bat: v("battery_power"),
        soc: v("battery_soc"),
        car: null,
        h: null,
      };
    } else {
      const h = hrs.find((x) => x.ts <= t && t < x.ts + 3600) ?? null;
      const hours = h ? Math.max(1, hourEnd(h) - h.start) / 3600 : 1;
      const kw = (v: number | null) => (v == null ? null : v * 1000);
      p = {
        t,
        recorded: false,
        pv: kw(lerp(pvAhead, t)),
        load: kw(lerp(loadAhead, t)),
        grid: h ? (h.grid_kwh / hours) * 1000 : null,
        bat: h ? ((hourKwh(h, h.load_kw + (h.car_kw ?? 0)) - h.pv_kwh - h.grid_kwh) / hours) * 1000 : null,
        soc: lerp(socAhead, t),
        car: h && h.car_kw ? h.car_kw * 1000 : null,
        h,
      };
    }
    return {
      ...p,
      pvTop: pct(p.pv == null ? null : Math.max(0, p.pv) / 1000, py, PH),
      loadTop: pct(p.load == null ? null : Math.max(0, p.load) / 1000, py, PH),
      socTop: pct(p.soc, by, BH),
    };
  };

  // The weather every three hours: the forecast's, or (earlier today) what was recorded.
  const sky = skyEvery3h(start, day.hours, recordedSky);

  return {
    start,
    span,
    point,
    flows,
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

/** The earlier forecast's average power (W) in hour `k`: its solar (kWh in the hour, so kW on average) and its
 * typical use (kW). */
function hourOf(o: Overlay, k: number) {
  const pv = o.pv[k];
  const load = o.load[k];
  return { pv: pv == null ? null : pv * 1000, load: load == null ? null : load * 1000 };
}

const WINDOW_COLOR: Record<Window["kind"], string> = { spare: COLOR.export, avoid: COLOR.bad, paid: COLOR.good };

/** A dot on a line at the hovered five minutes. `top` is a percentage of its plot's height. */
const Dot = ({ left, top, color }: { left: number; top: number | null; color: string }) =>
  top == null ? null : (
    <span
      className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
      style={{ left: `${left}%`, top: `${top}%`, background: color }}
    />
  );

/** The five minutes under the pointer: recorded (today, before now) or as forecast, in W as the lines are drawn. */
function PointTooltip({
  p,
  left,
  width,
  rates,
  marked,
  was,
  sky,
}: {
  p: Point;
  left: number;
  width: number;
  rates: Rates | null;
  /** Below the moments' row of numbers (MARKER_ROW). */
  marked: boolean;
  /** A recorded reading's earlier forecast for its hour (average W), with the overlay on. */
  was: { pv: number | null; load: number | null } | null;
  /** The hour's weather: the forecast's, or as recorded. */
  sky: { temp: number | null; code: number | null; is_day: number | null } | null;
}) {
  const fahrenheit = useFahrenheit();
  const icon = sky?.code != null ? hourIcon({ code: sky.code, is_day: sky.is_day ?? 1 }) : null;
  const power = (v: number | null) => (v == null ? DASH : kW(v));
  const g = p.grid ?? 0;
  const b = p.bat ?? 0;
  // What the grid power is priced at: feed-in while it exports, the buy price otherwise (the forecast's minutes only).
  const selling = g <= -50;
  const price = p.h && rates ? (selling ? rates.sell : rates.buy)(p.t, p.t + STEP) : null;
  const name = selling ? "Feed-in" : p.h && rates ? (rates.name(p.t, p.t + STEP) ?? "Grid price") : null;
  return (
    <ChartTooltip left={left} flip={left > 60} width={width} className={marked ? "top-[48px]" : "top-[22px]"}>
      <div className="flex items-end justify-between gap-2 font-medium text-ink">
        <span className="flex flex-col">
          <span className="text-[11px] font-normal text-ink-faint">{p.recorded ? "Recorded" : "Forecast"}</span>
          {hhmm(p.t)} to {hhmm(p.t + STEP)}
        </span>
        {icon && (
          <span className="flex items-center gap-1 text-ink-soft">
            <span style={{ color: hourIconColor(icon) }}>
              <Icon name={icon} size={14} />
            </span>
            {sky?.temp != null ? degrees(sky.temp, fahrenheit) : ""}
          </span>
        )}
      </div>
      <TooltipRow label="Solar" value={power(p.pv)} color={COLOR.solar} />
      {was?.pv != null && <TooltipRow label="Forecast solar" value={kW(was.pv)} />}
      <TooltipRow label="Home use" value={power(p.load)} color={COLOR.ink} />
      {was?.load != null && <TooltipRow label="Typical home use" value={kW(was.load)} />}
      {p.car != null && p.car >= 50 && <TooltipRow label="Car charging" value={kW(p.car)} color={COLOR.lilac} />}
      <TooltipRow label="Battery" value={p.soc == null ? DASH : pct(p.soc)} color={COLOR.battery} />
      {Math.abs(b) >= 50 && (
        <TooltipRow
          label={b > 0 ? "Discharging" : "Charging"}
          value={kW(Math.abs(b))}
          color={b > 0 ? FLOW_COLOR.discharge : FLOW_COLOR.charge}
        />
      )}
      <TooltipRow
        label={g >= 50 ? "From the grid" : g <= -50 ? "To the grid" : "Grid"}
        value={p.grid == null ? DASH : Math.abs(g) >= 50 ? kW(Math.abs(g)) : "Idle"}
        color={g >= 50 ? FLOW_COLOR.fromGrid : g <= -50 ? FLOW_COLOR.toGrid : undefined}
      />
      {price != null && <TooltipRow label={name} value={`${priceLabel(price)}/kWh`} />}
    </ChartTooltip>
  );
}

/**
 * A day of the plan, midnight to midnight: solar and home use, the battery level, and the grid and battery as bars
 * every half hour. Today shows what's been recorded up to now and the forecast after it; solar's likely range is
 * shaded around its forecast, and the day's best times are marked across the top, with its key moments numbered above
 * them. The pointer reads out five minutes at a time, as History does, with a dot on each line.
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
  const [hover, setHover] = useState<Point | null>(null);
  const [width, setWidth] = useState(0);
  const left = (t: number) => (c.X(t) / W) * 100;
  // The moments' numbers sit in a row of their own above the best-times strips.
  const top = moments.length || markerRow ? MARKER_ROW : 0;

  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth); // layout px, as the tooltip is placed in (r is zoomed with the page)
    const t = c.start + Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * c.span;
    // The five minutes it's in, as History reads them out (the bars stay half-hourly).
    setHover(c.point(c.start + Math.floor((t - c.start) / STEP) * STEP));
  };

  const legend: [string, string, "line" | "dash" | "box"][] = [
    ["Solar", COLOR.solar, "line"],
    ["Home use", COLOR.ink, "line"],
    ["Battery level", COLOR.battery, "line"],
    ["From grid", COLOR.fromGrid, "box"],
    ["Battery charge", FLOW_COLOR.charge, "box"],
    ["Sent to grid", COLOR.export, "box"],
    ["Battery discharge", FLOW_COLOR.discharge, "box"],
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
            style={{
              top: top + 22,
              left: `${left(hover.t)}%`,
              width: `max(3px, ${(left(hover.t + STEP) - left(hover.t)).toFixed(3)}%)`,
            }}
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
            {/* The earlier forecast for the hours gone, drawn as the forecast is: the legend's "Forecast" covers both. */}
            {c.pvWas && (
              <path d={c.pvWas} {...STROKE} strokeWidth="2" strokeDasharray="6 5" style={{ stroke: COLOR.solar }} />
            )}
            {c.loadWas && (
              <path d={c.loadWas} {...STROKE} strokeWidth="1.5" strokeDasharray="6 5" style={{ stroke: COLOR.ink }} />
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
          {hover && (
            <>
              <Dot left={left(hover.t + STEP / 2)} top={hover.pvTop} color={COLOR.solar} />
              <Dot left={left(hover.t + STEP / 2)} top={hover.loadTop} color={COLOR.ink} />
            </>
          )}
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
          {hover && <Dot left={left(hover.t + STEP / 2)} top={hover.socTop} color={COLOR.battery} />}
        </div>
        <FlowBars slots={c.flows} className="relative mt-1 h-[64px] compact:h-12" />
        {hover && (
          <PointTooltip
            p={hover}
            left={left(hover.t + STEP / 2)}
            width={width}
            rates={rates}
            marked={top > 0}
            was={overlay && hover.recorded ? hourOf(overlay, Math.floor((hover.t - c.start) / 3600)) : null}
            sky={
              hover.h ??
              recordedSky?.find((x) => x.ts === c.start + Math.floor((hover.t - c.start) / 3600) * 3600) ??
              null
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
