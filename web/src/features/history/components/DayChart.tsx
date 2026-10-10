import { useId, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import type { HistorySeries } from "~/features/common/readings/types";
import { ChartTooltip, nearest, TooltipRow } from "~/features/common/ui/components/ChartHover";
import {
  DragBand,
  TimeTicks,
  timeTicks,
  useDragRange,
  useZoom,
  ZoomOut,
} from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, pct } from "~/features/common/formatting/utils/number";
import { addDays, midnight } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { FLOW_COLOR, FlowBars } from "~/features/history/components/FlowBars";
import { HALF_HOUR, slotsOf } from "~/features/history/utils/day";

const W = 1000;
const H = 220;
const BH = 64; // the battery level's strip, as the Plan chart has it
const SOLAR = COLOR.solar;
const HOME = COLOR.ink;
const BATTERY = COLOR.battery;
const FROM_GRID = COLOR.fromGrid;
const TO_GRID = COLOR.export;

type Row = {
  t: number;
  pv: number | null;
  load: number | null;
  soc: number | null;
  grid: number | null;
  bat: number | null; // W, + discharging
};
type Key = "pv" | "load" | "soc";

/** Runs of consecutive readings, so gaps in the data show as gaps in the line. */
function segments(rows: Row[], k: Key): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] = [];
  for (const r of rows) {
    if (r[k] == null) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(r);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** A day's readings as rows, and the day they're on. */
function dayOf(series: HistorySeries) {
  const rows: Row[] = series.t.map((t, i) => ({
    t,
    pv: series.pv_power?.[i] ?? null,
    load: series.load_power?.[i] ?? null,
    soc: series.battery_soc?.[i] ?? null,
    grid: series.grid_power?.[i] ?? null,
    bat: series.battery_power?.[i] ?? null,
  }));
  // The chart's day comes from its own readings, so the previous day stays drawn while the next one loads.
  const start = rows.length ? midnight(rows[0].t) : 0;
  return {
    rows,
    start,
    end: addDays(start, 1),
    step: rows.length > 1 ? rows[1].t - rows[0].t : 300,
    recorded: rows.some((r) => r.pv != null || r.load != null || r.soc != null),
  };
}

/** The lines from `from` to `to` (the whole day, or a stretch of it dragged across), on a scale to fit them. */
function plot(rows: Row[], from: number, to: number) {
  // What's drawn takes in the reading either side of the stretch, so a line runs on to its edges (clipped there).
  const a = rows.findIndex((r) => r.t >= from);
  let b = rows.findIndex((r) => r.t > to);
  if (b < 0) b = rows.length;
  const drawn = a < 0 ? [] : rows.slice(Math.max(0, a - 1), Math.min(rows.length, b + 1));
  const shown = rows.filter((r) => r.t >= from && r.t <= to);
  const span = to - from;
  const values = shown.flatMap((r) => [r.pv, r.load]).filter((v) => v != null);
  const mx = Math.max(1000, ...values) * 1.1;
  const X = (t: number) => (((t - from) / span) * W).toFixed(1);
  const Yk = (v: number) => (H - (Math.max(0, v) / mx) * (H - 10)).toFixed(1);
  const Ys = (v: number) => (BH - 2 - (v / 100) * (BH - 4)).toFixed(1);
  const line = (pts: Row[], k: Key, fy: (v: number) => string) =>
    pts.map((r, i) => `${i ? "L" : "M"}${X(r.t)} ${fy(r[k] ?? 0)}`).join(" ");
  return {
    solar: segments(drawn, "pv").map((sg) => {
      const d = line(sg, "pv", Yk);
      return { d, area: `${d} L${X(sg[sg.length - 1].t)} ${H} L${X(sg[0].t)} ${H} Z` };
    }),
    home: segments(drawn, "load").map((sg) => line(sg, "load", Yk)),
    soc: segments(drawn, "soc").map((sg) => line(sg, "soc", Ys)),
    readings: shown.filter((r) => r.pv != null || r.load != null || r.soc != null),
    /** Where a reading sits, as percentages of the plot: across, and down to each line. */
    at: (r: Row) => ({
      left: ((r.t - from) / span) * 100,
      pv: r.pv == null ? null : (+Yk(r.pv) / H) * 100,
      load: r.load == null ? null : (+Yk(r.load) / H) * 100,
      soc: r.soc == null ? null : (+Ys(r.soc) / BH) * 100,
    }),
  };
}

const STROKE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/** The 5 minutes under the pointer, in the same tooltip as the Overview's Next 24 hours card. */
function ReadingTooltip({ r, step, left, width }: { r: Row; step: number; left: number; width: number }) {
  const g = r.grid ?? 0;
  return (
    <ChartTooltip left={left} flip={left > 60} width={width}>
      <span className="font-medium text-ink">
        {hhmm(r.t)} to {hhmm(r.t + step)}
      </span>
      <TooltipRow label="Solar" value={r.pv == null ? DASH : kW(r.pv)} color={SOLAR} />
      <TooltipRow
        label="Home use"
        value={r.load == null ? DASH : `${r.load < 0 ? "−" : ""}${kW(r.load)}`}
        color={HOME}
      />
      <TooltipRow label="Battery" value={pct(r.soc)} color={BATTERY} />
      {r.bat != null && Math.abs(r.bat) > 50 && (
        <TooltipRow
          label={r.bat > 0 ? "Discharging" : "Charging"}
          value={kW(Math.abs(r.bat))}
          color={r.bat > 0 ? FLOW_COLOR.discharge : FLOW_COLOR.charge}
        />
      )}
      <TooltipRow
        label={g > 50 ? "From the grid" : g < -50 ? "To the grid" : "Grid"}
        value={r.grid == null ? DASH : Math.abs(g) > 50 ? kW(g) : "Idle"}
        color={g > 50 ? FROM_GRID : g < -50 ? TO_GRID : undefined}
      />
    </ChartTooltip>
  );
}

/** A dot on a line at the hovered reading. `top` is a percentage of the plot's height. */
const Dot = ({ left, top, color }: { left: number; top: number | null; color: string }) =>
  top == null ? null : (
    <span
      className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
      style={{ left: `${left}%`, top: `${top}%`, background: color }}
    />
  );

/**
 * One day hour by hour: solar, home use and battery level from the 5-minute readings, the grid
 * as bars (from it above the line, to it below), and the 5-minute reading under the pointer in a tooltip.
 * Dragging across it shows just that stretch, its bars finer, with a button back out to the whole day.
 */
export function DayChart({
  series,
  placeholder,
  top,
  reserve,
}: {
  series: HistorySeries | undefined;
  placeholder: boolean;
  /** Something to show between the legend and the plots, lined up with them (the Overview's weather row). */
  top?: ReactNode;
  /** The battery's backup reserve (%), marked on its strip. */
  reserve?: number;
}) {
  const day = useMemo(() => series && dayOf(series), [series]);
  const zoom = useZoom(day?.start ?? 0, day?.end ?? 0); // a stretch of the day dragged across, shown on its own
  const { from, to } = zoom;
  const chart = useMemo(() => day && plot(day.rows, from, to), [day, from, to]);
  // The grid and battery bars, every half hour; zoomed in, finer (down to the 5-minute readings), at most 48 across.
  const every = zoom.zoomed ? ([300, 600, 900].find((s) => (to - from) / s <= 48) ?? HALF_HOUR) : HALF_HOUR;
  const flows = useMemo(() => (series && day ? slotsOf(series, day.start, every) : []), [series, day, every]);
  const [hover, setHover] = useState<Row | null>(null);
  const [width, setWidth] = useState(0);
  const by = (v: number) => BH - 2 - (v / 100) * (BH - 4);
  const clip = useId().replace(/:/g, "");
  const range = useDragRange(
    from,
    to,
    day?.recorded
      ? (a, b) => {
          setHover(null);
          zoom.zoom(a, b);
        }
      : undefined,
  );
  const hovered = range.dragging ? null : hover;

  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth); // layout px, as the tooltip is placed in (r is zoomed with the page)
    if (!day || !chart?.readings.length) return;
    const t = from + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (to - from);
    const best = nearest(chart.readings, t);
    setHover(best && Math.abs(best.t - t) <= 2 * day.step ? best : null);
  };

  // Zoomed in, the lines are held to the plot (they run on past it, to the readings either side).
  const clipTo = (id: string, h: number) => (
    <defs>
      <clipPath id={`${clip}-${id}`}>
        <rect x="0" y={-h} width={W} height={h * 3} />
      </clipPath>
    </defs>
  );
  const clipped = (id: string) => (zoom.zoomed ? `url(#${clip}-${id})` : undefined);

  // Zoomed in, only the slots in the stretch, placed by time (the ones at its ends cut off at the plot's edges).
  const first = Math.floor((from - (day?.start ?? 0)) / every);
  const last = Math.ceil((to - (day?.start ?? 0)) / every);
  const bars = zoom.zoomed ? (
    <div className="relative mt-1 h-[72px] overflow-hidden compact:h-14">
      <div
        className="absolute inset-y-0"
        style={{
          left: `${((((day?.start ?? 0) + first * every - from) / (to - from)) * 100).toFixed(3)}%`,
          width: `${((((last - first) * every) / (to - from)) * 100).toFixed(3)}%`,
        }}
      >
        <FlowBars slots={flows.slice(first, last)} className="relative h-full" />
      </div>
    </div>
  ) : (
    <FlowBars slots={flows} className="relative mt-1 h-[72px] compact:h-14" />
  );

  // The whole day's hours as ever; zoomed in, finer marks through the stretch.
  const ticks = zoom.zoomed
    ? timeTicks(from, to, 3)
    : [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h, i) => ({
        t: from + h * 3600,
        left: (h / 24) * 100,
        label: hourLabel(h),
        odd: i % 2 === 1,
      }));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-dim">
        {[
          ["Solar", SOLAR],
          ["Home use", HOME],
          ["Battery level", BATTERY],
        ].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: color }} />
            {label}
          </span>
        ))}
        {[
          ["From grid", FROM_GRID],
          ["Battery charge", FLOW_COLOR.charge],
          ["Sent to grid", TO_GRID],
          ["Battery discharge", FLOW_COLOR.discharge],
        ].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-[2px]" style={{ background: color }} />
            {label}
          </span>
        ))}
        {zoom.zoomed && <ZoomOut from={from} to={to} onClick={zoom.reset} className="-my-[5px] ml-auto" />}
      </div>
      {/* Lined up with the whole day, so left out while zoomed in. */}
      {!zoom.zoomed && top}
      <div
        className="relative flex cursor-crosshair touch-pan-y flex-col gap-1.5"
        onPointerMove={(e) => {
          onPoint(e);
          range.handlers.onPointerMove?.(e);
        }}
        onPointerDown={(e) => {
          onPoint(e);
          range.handlers.onPointerDown?.(e);
        }}
        onPointerUp={range.handlers.onPointerUp}
        onPointerCancel={range.handlers.onPointerCancel}
        onPointerLeave={() => setHover(null)}
      >
        <DragBand band={range.band} />
        {/* The hovered 5 minutes, as a soft band behind the lines and grid bars: the tooltip sums it up. */}
        {hovered && chart && day && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -translate-x-1/2 rounded-[3px] bg-fg/8"
            style={{
              left: `${chart.at(hovered).left.toFixed(3)}%`,
              width: `max(4px, ${((day.step / (to - from)) * 100).toFixed(3)}%)`,
            }}
          />
        )}
        <div className="relative h-[220px] max-sm:h-[180px] compact:h-[160px]">
          {["0%", "33%", "66%", "100%"].map((top) => (
            <div key={top} className="absolute right-0 left-0 border-t border-fg/5" style={{ top }} />
          ))}
          {chart && day && (
            // Keyed by day, so picking another day draws it in afresh.
            <svg
              key={day.start}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full animate-reveal-x overflow-visible"
            >
              <defs>
                <linearGradient id="hyPv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopOpacity="0.35" style={{ stopColor: COLOR.solarWash }} />
                  <stop offset="1" stopOpacity="0" style={{ stopColor: COLOR.solarWash }} />
                </linearGradient>
              </defs>
              {clipTo("kw", H)}
              <g clipPath={clipped("kw")}>
                {chart.solar.map((s, i) => (
                  <g key={i}>
                    <path d={s.area} fill="url(#hyPv)" />
                    <path d={s.d} {...STROKE} strokeWidth="2" style={{ stroke: SOLAR }} />
                  </g>
                ))}
                {chart.home.map((d, i) => (
                  <path key={i} d={d} {...STROKE} strokeWidth="1.5" style={{ stroke: HOME }} />
                ))}
              </g>
            </svg>
          )}
          {day && !placeholder && !day.recorded && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
              No readings were recorded on this day.
            </div>
          )}
          {hovered &&
            chart &&
            (() => {
              const at = chart.at(hovered);
              return (
                <>
                  <Dot left={at.left} top={at.pv} color={SOLAR} />
                  <Dot left={at.left} top={at.load} color={HOME} />
                </>
              );
            })()}
        </div>
        {reserve != null && (
          <div className="mt-1 flex items-center justify-end text-[11px] text-ink-dim tabular-nums">
            Reserve {reserve}%
          </div>
        )}
        {/* The battery level on a strip of its own, as the Plan chart draws it: full at the top, the reserve dashed. */}
        <div className={cn("relative h-16 compact:h-12", reserve == null && "mt-1")}>
          {chart && day && (
            <svg
              key={day.start}
              viewBox={`0 0 ${W} ${BH}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full animate-reveal-x overflow-visible"
            >
              <line
                x1="0"
                x2={W}
                y1={by(100)}
                y2={by(100)}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: alpha(COLOR.fg, 0.08) }}
              />
              {reserve != null && (
                <line
                  x1="0"
                  x2={W}
                  y1={by(reserve)}
                  y2={by(reserve)}
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                  style={{ stroke: alpha(COLOR.fg, 0.3) }}
                />
              )}
              {clipTo("soc", BH)}
              <g clipPath={clipped("soc")}>
                {chart.soc.map((d, i) => (
                  <path key={i} d={d} {...STROKE} strokeWidth="2.25" style={{ stroke: BATTERY }} />
                ))}
              </g>
              <line
                x1="0"
                x2={W}
                y1={BH - 2}
                y2={BH - 2}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: alpha(COLOR.fg, 0.12) }}
              />
            </svg>
          )}
          {hovered && chart && <Dot left={chart.at(hovered).left} top={chart.at(hovered).soc} color={BATTERY} />}
        </div>
        {bars}
        {hovered && chart && day && (
          <ReadingTooltip r={hovered} step={day.step} left={chart.at(hovered).left} width={width} />
        )}
      </div>
      <TimeTicks ticks={ticks} />
    </div>
  );
}
