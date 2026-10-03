import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { historyQuery } from "~/features/common/readings/api";
import type { HistoryResponse } from "~/features/common/readings/types";
import type { SystemInfo } from "~/features/common/live/types";
import { nearest } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import { batteryState, reserveOf } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

const B6W = 600;
const B6H = 150;
const SPAN = 6 * 3600;
const b6y = (soc: number) => B6H - 34 - (Math.max(0, Math.min(100, soc)) / 100) * (B6H - 62);

type Point = { t: number; soc: number; w: number | null };

// Blue while charging or idle, amber while discharging.
const stateColor = (w: number | null) => (batteryState(w) === "discharge" ? COLOR.solar : COLOR.battery);

/** Charted geometry for the last six hours (state of charge, split where readings are missing). */
function chartOf(series: HistoryResponse["series"], start: number, end: number) {
  const X = (t: number) => ((t - start) / (end - start)) * B6W;
  const raw = series.t.map((t, i) => ({
    t,
    soc: series.battery_soc?.[i] ?? null,
    w: series.battery_power?.[i] ?? null,
  }));
  const segs: Point[][] = [[]];
  for (const p of raw) {
    if (p.soc == null) segs.push([]);
    else segs[segs.length - 1].push({ t: p.t, soc: p.soc, w: p.w });
  }
  const runs = segs.filter((seg) => seg.length > 1);
  return { X, have: segs.flat(), runs };
}

/** "Last 6 hours" strip along the bottom of the Battery card, with a hover readout. */
export function BatteryHistory({ end, s }: { end: number | null; s: SystemInfo | undefined }) {
  // `end` follows the latest reading, so the key (and the window) moves once per reading. That already
  // refetches, so the query isn't POLL-keyed: invalidating the outgoing key would only fetch it once more.
  const e = end ?? 0;
  const start = e - SPAN;
  const { data } = useQuery({
    ...historyQuery({ start, end: e, points: 72, fields: ["battery_soc", "battery_power"] }),
    enabled: end != null,
    placeholderData: keepPreviousData,
  });
  const chart = useMemo(() => data && chartOf(data.series, start, e), [data, start, e]);
  const plot = useRef<HTMLDivElement>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);

  const onMove = (ev: MouseEvent) => {
    const r = plot.current?.getBoundingClientRect();
    if (r) setHoverAt(start + ((ev.clientX - r.left) / r.width) * SPAN);
  };

  const have = chart?.have ?? [];
  const first = have[0];
  const last = have[have.length - 1];
  const cap = s?.battery_kwh;
  const dk = last && cap ? ((last.soc - first.soc) / 100) * cap : null;
  const ry = b6y(reserveOf(s)).toFixed(1);
  const hover = chart && hoverAt != null ? nearest(have, hoverAt) : null;

  return (
    <div
      ref={plot}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverAt(null)}
      className="relative mt-auto mb-0 h-[150px] cursor-crosshair"
    >
      <svg
        viewBox={`0 0 ${B6W} ${B6H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 block size-full"
      >
        {chart && last && (
          <>
            <defs>
              <linearGradient id="b6fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopOpacity="0.32" style={{ stopColor: COLOR.battery }} />
                <stop offset="0.7" stopOpacity="0.06" style={{ stopColor: COLOR.battery }} />
                <stop offset="1" stopOpacity="0" style={{ stopColor: COLOR.battery }} />
              </linearGradient>
              <linearGradient id="b6fadeX" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.35" stopColor="#fff" stopOpacity="1" />
                <stop offset="1" stopColor="#fff" stopOpacity="1" />
              </linearGradient>
              <mask id="b6mask">
                <rect x="0" y="0" width={B6W} height={B6H} fill="url(#b6fadeX)" />
              </mask>
            </defs>
            <g mask="url(#b6mask)">
              {chart.runs.map((seg, k) => (
                <path
                  key={k}
                  d={`M${chart.X(seg[0].t).toFixed(1)} ${B6H} ${seg.map((p) => `L${chart.X(p.t).toFixed(1)} ${b6y(p.soc).toFixed(1)}`).join(" ")} L${chart.X(seg[seg.length - 1].t).toFixed(1)} ${B6H} Z`}
                  fill="url(#b6fill)"
                />
              ))}
              {chart.runs.map((seg, k) =>
                seg
                  .slice(1)
                  .map((p, i) => (
                    <line
                      key={`${k}-${i}`}
                      x1={chart.X(seg[i].t).toFixed(1)}
                      y1={b6y(seg[i].soc).toFixed(1)}
                      x2={chart.X(p.t).toFixed(1)}
                      y2={b6y(p.soc).toFixed(1)}
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ stroke: stateColor(p.w) }}
                    />
                  )),
              )}
              <line
                x1="0"
                x2={B6W}
                y1={ry}
                y2={ry}
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: alpha(COLOR.fg, 0.1) }}
              />
            </g>
          </>
        )}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[1.2px] text-ink-label uppercase">Last 6 hours</span>
        <span className="text-xs text-ink-muted tabular-nums">
          {chart &&
            (last
              ? `${Math.round(first.soc)}% → ${Math.round(last.soc)}%` +
                (dk != null ? ` · ${dk >= 0 ? "+" : "−"}${kWh(Math.abs(dk))}` : "")
              : "No readings yet")}
        </span>
      </div>
      {/* Each time sits under its point on the chart; the end labels hang inward from the edges. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 h-3.5 font-mono text-[10px] text-ink-faint tabular-nums">
        {chart &&
          [6, 4, 2, 0].map((o) => (
            <span
              key={o}
              className={cn(
                "absolute whitespace-nowrap",
                o === 6 ? "" : o === 0 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${(((6 - o) / 6) * 100).toFixed(2)}%` }}
            >
              {o ? hhmm(e - o * 3600) : "Now"}
            </span>
          ))}
      </div>
      {chart && hover && <HoverReadout p={hover} left={(chart.X(hover.t) / B6W) * 100} />}
      {chart && last && (
        <span
          className="pointer-events-none absolute -mt-1 -ml-1.5 size-2 rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
          style={{
            left: `${(chart.X(last.t) / B6W) * 100}%`,
            top: `${(b6y(last.soc) / B6H) * 100}%`,
            background: stateColor(last.w),
          }}
        />
      )}
    </div>
  );
}

function HoverReadout({ p, left }: { p: Point; left: number }) {
  const st = batteryState(p.w);
  const flip = left > 60;
  return (
    <>
      <div
        className="pointer-events-none absolute top-6 bottom-[30px] border-l border-dashed border-line-strong"
        style={{ left: `${left}%` }}
      />
      <div
        className="pointer-events-none absolute top-[26px] z-2 rounded-lg bg-ink px-2 py-1 text-xs whitespace-nowrap text-ink-inverse tabular-nums"
        style={flip ? { right: `calc(${100 - left}% + 8px)` } : { left: `calc(${left}% + 8px)` }}
      >
        <b className="mr-1 font-semibold">{hhmm(p.t)}</b> {pct(p.soc)} ·{" "}
        {st === "charge" ? `Charging ${kW(p.w)}` : st === "discharge" ? `Discharging ${kW(p.w)}` : "Idle"}
      </div>
    </>
  );
}
