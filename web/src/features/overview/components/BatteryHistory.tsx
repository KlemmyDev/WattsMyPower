import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { historyQuery } from "~/features/common/readings/api";
import type { HistoryResponse } from "~/features/common/readings/types";
import type { SystemInfo } from "~/features/common/live/types";
import { nearest } from "~/features/common/ui/components/ChartHover";
import { batteryState, reserveOf } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, pct } from "~/features/common/formatting/utils/number";

const B6W = 600;
const B6H = 150;
const SPAN = 6 * 3600;
const b6y = (soc: number) => B6H - 34 - (Math.max(0, Math.min(100, soc)) / 100) * (B6H - 62);

type Point = { t: number; soc: number; w: number | null };

// Blue while charging or idle, amber while discharging.
const stateColor = (w: number | null) => (batteryState(w) === "discharge" ? "#ffb547" : "#6f8cff");

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
      className="relative -mx-7 mt-auto mb-0 h-[150px] cursor-crosshair max-sm:-mx-5"
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
                <stop offset="0" stopColor="#6f8cff" stopOpacity="0.32" />
                <stop offset="0.7" stopColor="#6f8cff" stopOpacity="0.06" />
                <stop offset="1" stopColor="#6f8cff" stopOpacity="0" />
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
                      stroke={stateColor(p.w)}
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )),
              )}
              <line
                x1="0"
                x2={B6W}
                y1={ry}
                y2={ry}
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </>
        )}
      </svg>
      <div className="pointer-events-none absolute top-1.5 right-7 left-7 flex items-baseline justify-between gap-3 max-sm:right-5 max-sm:left-5">
        <span className="font-mono text-[10px] tracking-[1.2px] text-[#7a7a7a] uppercase">Last 6 hours</span>
        <span className="text-xs text-ink-muted tabular-nums">
          {chart &&
            (last
              ? `${Math.round(first.soc)}% → ${Math.round(last.soc)}%` +
                (dk != null ? ` · ${dk >= 0 ? "+" : "−"}${Math.abs(dk).toFixed(1)} kWh` : "")
              : "No readings yet")}
        </span>
      </div>
      <div className="pointer-events-none absolute right-7 bottom-3 left-7 flex justify-between font-mono text-[10px] text-ink-faint tabular-nums max-sm:right-5 max-sm:left-5">
        {chart && [6, 4, 2, 0].map((o) => <span key={o}>{o ? hhmm(e - o * 3600) : "Now"}</span>)}
      </div>
      {chart && hover && <HoverReadout p={hover} left={(chart.X(hover.t) / B6W) * 100} />}
      {chart && last && (
        <span
          className="pointer-events-none absolute -mt-1 -ml-1.5 size-2 rounded-full shadow-[0_0_0_2px_#141414]"
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
