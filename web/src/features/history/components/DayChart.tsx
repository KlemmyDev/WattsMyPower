import { useMemo, useState, type PointerEvent } from "react";
import type { HistorySeries } from "~/features/common/readings/types";
import { ChartTooltip, HoverLine, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import { hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import { addDays, midnight } from "~/features/common/time/utils";
import type { Hour } from "~/features/history/utils/day";

const W = 1000;
const H = 220;
const SOLAR = "#ffb547";
const HOME = "#f5f5f5";
const BATTERY = "#6f8cff";
const FROM_GRID = "#8a8a90";
const TO_GRID = "#f2a65a";

type Row = { t: number; pv: number | null; load: number | null; soc: number | null };
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

function plot(series: HistorySeries) {
  const rows: Row[] = series.t.map((t, i) => ({
    t,
    pv: series.pv_power?.[i] ?? null,
    load: series.load_power?.[i] ?? null,
    soc: series.battery_soc?.[i] ?? null,
  }));
  // The chart's day comes from its own readings, so the previous day stays drawn while the next one loads.
  const start = rows.length ? midnight(rows[0].t) : 0;
  const span = addDays(start, 1) - start;
  const values = rows.flatMap((r) => [r.pv, r.load]).filter((v) => v != null);
  const mx = Math.max(1000, ...values) * 1.1;
  const X = (t: number) => (((t - start) / span) * W).toFixed(1);
  const Yk = (v: number) => (H - (Math.max(0, v) / mx) * (H - 10)).toFixed(1);
  const Ys = (v: number) => (H - (v / 100) * (H - 10)).toFixed(1);
  const line = (pts: Row[], k: Key, fy: (v: number) => string) =>
    pts.map((r, i) => `${i ? "L" : "M"}${X(r.t)} ${fy(r[k] ?? 0)}`).join(" ");
  return {
    start,
    span,
    solar: segments(rows, "pv").map((sg) => {
      const d = line(sg, "pv", Yk);
      return { d, area: `${d} L${X(sg[sg.length - 1].t)} ${H} L${X(sg[0].t)} ${H} Z` };
    }),
    home: segments(rows, "load").map((sg) => line(sg, "load", Yk)),
    soc: segments(rows, "soc").map((sg) => line(sg, "soc", Ys)),
    readings: rows.filter((r) => r.pv != null),
  };
}

const STROKE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/** The hour under the pointer, in the same tooltip as the Overview's Next 24 hours card. */
function HourTooltip({ hour, at, width }: { hour: Hour; at: number; width: number }) {
  const g = hour.grid ?? 0;
  const left = ((at + 0.5) / 24) * 100;
  return (
    <ChartTooltip left={left} flip={left > 60} width={width}>
      <span className="font-medium text-ink">
        {hourLabel(at)} to {hourLabel(at + 1)}
      </span>
      {/* Each hour's energy is its average power, so kWh in an hour reads as kW. */}
      <TooltipRow label="Solar" value={hour.pv == null ? DASH : kW(hour.pv * 1000)} color={SOLAR} />
      <TooltipRow label="Home use" value={hour.load == null ? DASH : kW(hour.load * 1000)} color={HOME} />
      <TooltipRow label={`Battery at ${hourLabel(at + 1)}`} value={pct(hour.soc)} color={BATTERY} />
      <TooltipRow
        label={g > 0.05 ? "From the grid" : g < -0.05 ? "To the grid" : "Grid"}
        value={Math.abs(g) > 0.05 ? kWh(Math.abs(g)) : "Idle"}
      />
    </ChartTooltip>
  );
}

/**
 * One day hour by hour: solar, home use and battery level from the 5-minute readings, the grid
 * as bars (from it above the line, to it below), and the hour under the pointer in a tooltip.
 */
export function DayChart({
  series,
  hours,
  placeholder,
}: {
  series: HistorySeries | undefined;
  hours: Hour[];
  placeholder: boolean;
}) {
  const chart = useMemo(() => series && plot(series), [series]);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const gMax = Math.max(0.5, ...hours.map((h) => Math.abs(h.grid ?? 0))) * 1.1;

  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(r.width);
    setHover(Math.max(0, Math.min(23, Math.floor(((e.clientX - r.left) / r.width) * 24))));
  };

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
          ["Sent to grid", TO_GRID],
        ].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-[2px]" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      <div
        className="relative flex cursor-crosshair touch-pan-y flex-col gap-1.5"
        onPointerMove={onPoint}
        onPointerDown={onPoint}
        onPointerLeave={() => setHover(null)}
      >
        <div className="relative h-[220px] max-sm:h-[180px]">
          {["0%", "33%", "66%", "100%"].map((top) => (
            <div key={top} className="absolute right-0 left-0 border-t border-white/5" style={{ top }} />
          ))}
          {chart && (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              <defs>
                <linearGradient id="hyPv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={SOLAR} stopOpacity="0.35" />
                  <stop offset="1" stopColor={SOLAR} stopOpacity="0" />
                </linearGradient>
              </defs>
              {chart.solar.map((s, i) => (
                <g key={i}>
                  <path d={s.area} fill="url(#hyPv)" />
                  <path d={s.d} {...STROKE} stroke={SOLAR} strokeWidth="2" />
                </g>
              ))}
              {chart.home.map((d, i) => (
                <path key={i} d={d} {...STROKE} stroke={HOME} strokeWidth="1.5" />
              ))}
              {chart.soc.map((d, i) => (
                <path key={i} d={d} {...STROKE} stroke={BATTERY} strokeWidth="1.5" strokeDasharray="5 5" />
              ))}
            </svg>
          )}
          {chart && !placeholder && !chart.readings.length && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
              No readings were recorded on this day.
            </div>
          )}
        </div>
        <div className="relative h-[72px]">
          <div className="absolute inset-x-0 top-1/2 border-t border-white/12" />
          <div className="absolute inset-0 flex gap-0.5">
            {hours.map((h, i) => {
              const g = h.grid ?? 0;
              const hh = (Math.abs(g) / gMax) * 50;
              return (
                <div key={i} className="relative min-w-0 flex-1">
                  {Math.abs(g) >= 0.05 && (
                    <div
                      className="absolute inset-x-0 rounded-[2px]"
                      style={{
                        top: `${(g > 0 ? 50 - hh : 50).toFixed(2)}%`,
                        height: `${Math.max(1, hh).toFixed(2)}%`,
                        background: g > 0 ? FROM_GRID : TO_GRID,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {hover != null && (
          <>
            <HoverLine left={((hover + 0.5) / 24) * 100} />
            <HourTooltip hour={hours[hover]} at={hover} width={width} />
          </>
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
