import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type MouseEvent } from "react";
import { historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { ChartTooltip, HoverLine, nearest, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { kW, pct } from "~/features/common/formatting/utils/number";
import { addDays, midnight } from "~/features/common/time/utils";

const W = 1000;
const H = 240;
const FIELDS = ["pv_power", "load_power", "battery_soc"];
const SOLAR = "#ffb547";
const HOME = "#f5f5f5";
const BATTERY = "#3ee08f";

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

/** One day's solar, home use and battery level, in 5-minute averages (288 a day). */
export function DayChart({ dayTs, live }: { dayTs: number; live: boolean }) {
  const q = useQuery({
    ...historyQuery({ start: dayTs, end: addDays(dayTs, 1), points: 288, fields: FIELDS, live }),
    placeholderData: keepPreviousData,
  });
  const chart = useMemo(() => q.data && plot(q.data.series), [q.data]);
  const [hover, setHover] = useState<Row | null>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!chart?.readings.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = chart.start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * chart.span;
    const best = nearest(chart.readings, t);
    setHover(best && Math.abs(best.t - t) <= 1800 ? best : null);
  };
  const lp = chart && hover ? ((hover.t - chart.start) / chart.span) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex gap-5 text-xs text-ink-dim">
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
      </div>
      <div className="relative h-60 cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
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
        {chart && !q.isPlaceholderData && !chart.readings.length && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
            No readings were recorded on this day.
          </div>
        )}
        {hover && (
          <>
            <HoverLine left={lp} />
            <ChartTooltip left={lp} flip={lp > 70}>
              <div className="flex justify-between font-semibold">
                <span>{hhmm(hover.t)}</span>
              </div>
              <TooltipRow label="Solar" value={kW(hover.pv)} color={SOLAR} />
              <TooltipRow
                label="Home"
                value={`${hover.load != null && hover.load < 0 ? "−" : ""}${kW(hover.load)}`}
                color={HOME}
              />
              <TooltipRow label="Battery" value={pct(hover.soc)} color={BATTERY} />
            </ChartTooltip>
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
