import { useId, useMemo, useState, type PointerEvent } from "react";
import { alpha } from "~/features/common/theme/utils/colors";
import { HoverLine } from "~/features/common/ui/components/ChartHover";
import { timeTicks, TimeTicks } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";

const W = 1000;
const PAD = 8;
const SNAP = 300; // a moment picked lands on the five minutes, as the readings do
const GAP = 900; // readings further apart than this break the line

/** A line on the chart: its readings, and how it's drawn. `dim` fades it back while something else is pointed at. */
export type ScrubLine = {
  key: string;
  color: string;
  t: number[];
  v: (number | null)[];
  dashed?: boolean;
  fill?: boolean;
  dim?: boolean;
};

/** The top of the scale: the readings' highest, rounded up to a 1, 2, 2.5 or 5 so the halfway line reads cleanly. */
function niceTop(max: number) {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max * 1.04));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= max * 1.04) ?? 10) * p;
}

/**
 * Lines through part of a day, read by moving along them rather than through a tooltip: the moment under the pointer
 * (or chosen with the arrow keys, through a range input a screen reader can use too) is handed to `onAt`, and the card
 * around the chart shows that moment's values in its own header. `mode="hover"` follows the pointer and lets go when
 * it leaves (a chart to read); `"pick"` moves only while pressed and keeps the moment (a chart to choose a time with).
 */
export function ScrubChart({
  lines,
  start,
  end,
  at,
  onAt,
  mode = "hover",
  height = 220,
  every = 2,
  now,
  axis,
  label,
  describe,
  rest,
}: {
  lines: ScrubLine[];
  start: number;
  end: number;
  at: number | null;
  onAt: (t: number | null) => void;
  mode?: "hover" | "pick";
  height?: number;
  /** Hours between the time marks along the bottom. */
  every?: number;
  now?: number;
  /** How a value on the scale reads ("4 kW", "300 V"). */
  axis: (v: number) => string;
  /** What the chart shows, for a screen reader. */
  label: string;
  /** A moment's values in words, read out as the keys move along. */
  describe: (t: number) => string;
  /** Where the keys start from when nothing's chosen yet (the latest reading). */
  rest?: number;
}) {
  const H = height;
  const clip = useId().replace(/:/g, "");
  const [down, setDown] = useState(false);
  const chart = useMemo(() => {
    const within = (t: number) => t >= start - GAP && t <= end + GAP;
    let max = 0;
    for (const l of lines)
      l.t.forEach((t, i) => {
        const v = l.v[i];
        if (v != null && t >= start && t <= end) max = Math.max(max, v);
      });
    const top = niceTop(max);
    const X = (t: number) => ((t - start) / (end - start)) * W;
    const Y = (v: number) => H - PAD - (Math.max(0, v) / top) * (H - 2 * PAD);
    const drawn = lines.map((l) => {
      const runs: string[] = [];
      const fills: string[] = [];
      let cur: { x: number; y: number }[] = [];
      let prev: number | null = null;
      const close = () => {
        if (cur.length > 1) {
          const d = cur.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
          runs.push(d);
          const base = Y(0).toFixed(1);
          fills.push(`${d} L${cur[cur.length - 1].x.toFixed(1)} ${base} L${cur[0].x.toFixed(1)} ${base} Z`);
        }
        cur = [];
      };
      l.t.forEach((t, i) => {
        const v = l.v[i];
        if (!within(t)) return;
        if (v == null || (prev != null && t - prev > GAP)) close();
        if (v != null) cur.push({ x: X(t), y: Y(v) });
        prev = v != null ? t : prev;
      });
      close();
      return { ...l, runs, fills };
    });
    return { top, drawn, leftOf: (t: number) => (X(t) / W) * 100, topOf: (v: number) => (Y(v) / H) * 100 };
  }, [lines, start, end, H]);

  const timeAt = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (end - start);
    return Math.max(start, Math.min(end, Math.round(t / SNAP) * SNAP));
  };
  const hover = mode === "hover";
  const shown = at != null && at >= start && at <= end ? at : null;
  // Each line's reading at the moment, for its dot.
  const dots =
    shown == null
      ? []
      : chart.drawn.flatMap((l) => {
          let best = -1;
          l.t.forEach((t, i) => {
            if (l.v[i] != null && (best < 0 || Math.abs(t - shown) < Math.abs(l.t[best] - shown))) best = i;
          });
          return best >= 0 && Math.abs(l.t[best] - shown) <= 600 ? [{ key: l.key, color: l.color, v: l.v[best]! }] : [];
        });
  const nowLeft = now != null && now >= start && now <= end ? chart.leftOf(now) : null;
  const value = shown ?? rest ?? start;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className={cn(
          "relative touch-pan-y rounded-lg outline-offset-4 select-none has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ink/40",
          hover ? "cursor-crosshair" : "cursor-ew-resize",
        )}
        style={{ height: H }}
        onPointerMove={(e) => {
          if (hover || down) onAt(timeAt(e));
        }}
        onPointerDown={(e) => {
          if (!hover) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDown(true);
          }
          onAt(timeAt(e));
        }}
        onPointerUp={() => setDown(false)}
        onPointerCancel={() => setDown(false)}
        onPointerLeave={() => {
          if (hover) onAt(null);
        }}
      >
        <input
          type="range"
          className="sr-only"
          aria-label={label}
          aria-valuetext={describe(value)}
          min={start}
          max={end}
          step={SNAP}
          value={Math.max(start, Math.min(end, value))}
          onChange={(e) => onAt(Number(e.target.value))}
          onBlur={() => {
            if (hover) onAt(null);
          }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-fg/5" style={{ top: PAD }} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-fg/5" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-fg/10"
          style={{ top: H - PAD }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 font-mono text-[10.5px] text-ink-faint tabular-nums"
          style={{ top: PAD + 2 }}
        >
          {axis(chart.top)}
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 pt-0.5 font-mono text-[10.5px] text-ink-faint tabular-nums"
        >
          {axis(chart.top / 2)}
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <clipPath id={clip}>
              <rect x="0" y={-H} width={W} height={H * 3} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clip})`}>
            {chart.drawn.map((l) => (
              <g
                key={l.key}
                className="transition-opacity duration-200 motion-reduce:transition-none"
                style={{ opacity: l.dim ? 0.35 : 1 }}
              >
                {l.fill && l.fills.map((d, i) => <path key={i} d={d} style={{ fill: alpha(l.color, 0.14) }} />)}
                {l.runs.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeWidth={l.dashed ? 1.5 : 2}
                    strokeDasharray={l.dashed ? "4 4" : undefined}
                    strokeOpacity={l.dashed ? 0.7 : 1}
                    style={{ stroke: l.color }}
                  />
                ))}
              </g>
            ))}
          </g>
        </svg>
        {nowLeft != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line-strong"
            style={{ left: `${nowLeft}%` }}
          >
            <span className="absolute -top-0.5 left-1.5 font-mono text-[10px] text-ink-faint">Now</span>
          </div>
        )}
        {shown != null && (
          <>
            <HoverLine left={chart.leftOf(shown)} className="border-ink-muted" />
            {dots.map((d) => (
              <span
                key={d.key}
                aria-hidden
                className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
                style={{ left: `${chart.leftOf(shown)}%`, top: `${chart.topOf(d.v)}%`, background: d.color }}
              />
            ))}
          </>
        )}
      </div>
      <TimeTicks ticks={timeTicks(start, end, every)} />
    </div>
  );
}

/** A coloured dot for a line, in a readout or a legend. */
export function LineDot({ color, dashed }: { color: string; dashed?: boolean }) {
  return dashed ? (
    <span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed" style={{ borderColor: color }} />
  ) : (
    <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />
  );
}
