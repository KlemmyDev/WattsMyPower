import { useId, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { ChartTooltip, HoverLine } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";

const W = 1000;
const PAD = 8;
const HOUR = 3600;
const MIN_RANGE = 10 * 60; // the shortest stretch a drag picks
const SNAP = 5 * 60; // a stretch picked starts and ends on the five minutes
const DRAG_PX = 6; // how far the pointer moves before a press is a drag

/**
 * The marks along the bottom of a chart from `start` to `end`: every `every` hours, or, zoomed in to less than twice
 * that, finer ones (each hour, half hour, quarter hour…) so there are still a few. `odd` ones are left out on a phone.
 */
export function timeTicks(start: number, end: number, every: number) {
  const span = end - start;
  const fine = span < every * HOUR * 2;
  const step = !fine ? every * HOUR : ([5, 10, 15, 30, 60, 120, 180].find((m) => span / (m * 60) <= 8) ?? 360) * 60;
  const out: { t: number; left: number; label: string; odd: boolean }[] = [];
  if (!fine) {
    for (let t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR) {
      const h = new Date(t * 1000).getHours();
      if (h % every) continue;
      out.push({ t, left: ((t - start) / span) * 100, label: hourLabel(h), odd: (h / every) % 2 === 1 });
    }
    return out;
  }
  for (let t = Math.ceil(start / step) * step, i = 0; t <= end; t += step, i++) {
    const d = new Date(t * 1000);
    const label = d.getMinutes() === 0 ? hourLabel(d.getHours()) : hhmm(t);
    out.push({ t, left: ((t - start) / span) * 100, label, odd: Math.round(t / step) % 2 === 1 });
  }
  return out;
}

/** The time marks along a chart's bottom, as `timeTicks` gives them. */
export function TimeTicks({ ticks }: { ticks: ReturnType<typeof timeTicks> }) {
  return (
    <div className="relative h-3.5">
      {ticks.map((t, i) => (
        <span
          key={t.t}
          className={cn(
            "absolute font-mono text-[11px] whitespace-nowrap text-ink-faint",
            t.left < 3 ? "" : t.left > 97 ? "-translate-x-full" : "-translate-x-1/2",
            t.odd && i !== 0 && "max-md:hidden",
          )}
          style={{ left: `${t.left}%` }}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Dragging across a chart to pick a stretch of it, from `start` to `end`: spread `handlers` on the plot, draw `band`
 * (from and to as percentages of its width) while it's dragged, and `onRange` is given the stretch picked (at least ten
 * minutes, on the five minutes) when it's let go. Without `onRange` it does nothing.
 */
export function useDragRange(start: number, end: number, onRange?: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; to: number; x0: number; x: number } | null>(null);
  const at = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (end - start);
  };
  const moved = drag != null && Math.abs(drag.x - drag.x0) >= DRAG_PX;
  const pc = (t: number) => ((t - start) / (end - start)) * 100;
  return {
    dragging: moved,
    band: moved ? { from: pc(Math.min(drag.from, drag.to)), to: pc(Math.max(drag.from, drag.to)) } : null,
    handlers: onRange
      ? {
          onPointerDown: (e: PointerEvent<HTMLElement>) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const t = at(e);
            setDrag({ from: t, to: t, x0: e.clientX, x: e.clientX });
          },
          onPointerMove: (e: PointerEvent<HTMLElement>) => {
            if (drag) setDrag({ ...drag, to: at(e), x: e.clientX });
          },
          onPointerUp: () => {
            if (drag && moved) {
              // Snapped out to the five minutes either side.
              const from = Math.floor(Math.min(drag.from, drag.to) / SNAP) * SNAP;
              const to = Math.ceil(Math.max(drag.from, drag.to) / SNAP) * SNAP;
              const mid = (from + to) / 2;
              onRange(
                Math.max(start, Math.min(from, mid - MIN_RANGE / 2)),
                Math.min(end, Math.max(to, mid + MIN_RANGE / 2)),
              );
            }
            setDrag(null);
          },
          onPointerCancel: () => setDrag(null),
        }
      : {},
  };
}

/**
 * A stretch of a chart's `start` to `end` zoomed into (by dragging across it): `from` and `to` are what to show, the
 * whole of it until something's picked. It's let go when `start` or `end` change (another day).
 */
export function useZoom(start: number, end: number) {
  const [z, setZ] = useState<{ start: number; end: number; from: number; to: number } | null>(null);
  const on = z && z.start === start && z.end === end ? z : null;
  return {
    from: on?.from ?? start,
    to: on?.to ?? end,
    zoomed: on != null,
    zoom: (from: number, to: number) => setZ({ start, end, from, to }),
    reset: () => setZ(null),
  };
}

/** The button back out of a zoomed chart, saying what's shown: "10:00 – 12:00 · Show the whole day". */
export function ZoomOut({
  from,
  to,
  onClick,
  label = "Show the whole day",
  className,
}: {
  from: number;
  to: number;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border border-line px-3 py-[5px] text-xs whitespace-nowrap text-ink-muted tabular-nums transition-colors hover:border-fg/25 hover:text-ink",
        className,
      )}
    >
      {hhmm(from)} – {hhmm(to)} · {label}
    </button>
  );
}

/** The stretch being dragged across, shaded over the plot. */
export function DragBand({ band }: { band: { from: number; to: number } | null }) {
  if (!band) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 z-1 border-x border-fg/25 bg-fg/8"
      style={{ left: `${band.from}%`, width: `${band.to - band.from}%` }}
    />
  );
}

/** A reading on the line: dashed where it's a forecast. */
export type LinePoint = { t: number; v: number | null; forecast?: boolean };

const STROKE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/** Runs of points with values, split where they're missing or where actuals give way to the forecast. */
function runs(points: LinePoint[]) {
  const out: { pts: LinePoint[]; forecast: boolean }[] = [];
  let cur: { pts: LinePoint[]; forecast: boolean } | null = null;
  for (const p of points) {
    if (p.v == null) {
      cur = null;
      continue;
    }
    const f = !!p.forecast;
    if (!cur || cur.forecast !== f) {
      // The forecast carries on from the last actual, so the line doesn't break where it starts.
      const from: LinePoint[] = cur && !cur.forecast && f ? [cur.pts[cur.pts.length - 1]] : [];
      cur = { pts: [...from], forecast: f };
      out.push(cur);
    }
    cur.pts.push(p);
  }
  return out.filter((r) => r.pts.length > 1);
}

/**
 * One measure through a stretch of time, as a line (dashed where it's a forecast), with what's under the pointer in a
 * tooltip. `signed` fills above zero in one colour and below in another (the grid: from it, to it); `band` shades the
 * range a value should stay in; `marks` are reference lines with a label. `fill` shades under the line; `compare` draws
 * a second line (dashed: what was expected) on the same scale, and the tooltip is given both. With `onRange`, dragging
 * across it picks a stretch to look at more closely (the caller then shows just that, as `start` and `end`).
 */
export function TimeLine({
  points,
  start: whole,
  end: wholeEnd,
  now,
  color,
  height = 160,
  domain,
  signed,
  band,
  spans = [],
  events = [],
  marks = [],
  every = 6,
  fill = false,
  compare,
  tip,
  empty,
  onRange,
  zoom = true,
}: {
  points: LinePoint[];
  start: number;
  end: number;
  now?: number;
  color: string;
  height?: number;
  /** The values the plot must show, at least (it grows to fit the readings). */
  domain?: [number, number];
  signed?: { above: string; below: string };
  band?: { from: number; to: number; label?: string };
  /** Stretches of time to shade behind the line (when a car was away, when it charged), each in its own colour. */
  spans?: { from: number; to: number; color: string }[];
  /** Moments to mark along the top (when a car was woken), each a dot in its colour, with what it was. */
  events?: { t: number; color: string; label: string }[];
  marks?: { v: number; label: string; color?: string }[];
  /** Hours between the marks along the bottom (every other one is left out on a phone). */
  every?: number;
  fill?: boolean;
  compare?: { points: LinePoint[]; color: string };
  /** What's under the pointer: the line's reading (its `v` null where there's none, beyond the readings so far)
   * and the compared line's. */
  tip: (p: LinePoint, other?: LinePoint | null) => ReactNode;
  empty?: ReactNode;
  /** A stretch was dragged across, to show just that: the caller zooms (to keep charts together). Without it the
   * chart zooms itself, with its own button back out, unless `zoom` is false. */
  onRange?: (from: number, to: number) => void;
  zoom?: boolean;
}) {
  const H = height;
  const own = useZoom(whole, wholeEnd);
  const self = zoom && !onRange;
  const start = self ? own.from : whole;
  const end = self ? own.to : wholeEnd;
  const clip = useId().replace(/:/g, "");
  const chart = useMemo(() => {
    // What's drawn takes in the point either side of the stretch shown, so a line runs on to its edges (clipped there).
    const within = (list: LinePoint[]) => {
      const a = list.findIndex((p) => p.t >= start);
      if (a < 0) return [];
      let b = list.findIndex((p) => p.t > end);
      if (b < 0) b = list.length;
      return list.slice(Math.max(0, a - 1), Math.min(list.length, b + 1));
    };
    const drawn = within(points);
    const shown = points.filter((p) => p.t >= start && p.t <= end);
    const other = (compare?.points ?? []).filter((p) => p.t >= start && p.t <= end);
    const values = [...shown, ...other].map((p) => p.v).filter((v): v is number => v != null);
    let lo = Math.min(...values, domain?.[0] ?? Infinity, ...(signed ? [0] : []));
    let hi = Math.max(...values, domain?.[1] ?? -Infinity, ...(signed ? [0] : []));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
    if (hi - lo < 1e-9) hi = lo + 1;
    const span = hi - lo;
    if (!domain || hi > domain[1]) hi += span * 0.08;
    if ((!domain || lo < domain[0]) && !(signed && lo === 0)) lo -= span * 0.08;
    const X = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / (end - start)) * W;
    const Xd = (t: number) => ((t - start) / (end - start)) * W; // not held to the stretch: clipped instead
    const Y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
    const path = (pts: LinePoint[]) =>
      pts.map((p, i) => `${i ? "L" : "M"}${Xd(p.t).toFixed(1)} ${Y(p.v ?? 0).toFixed(1)}`).join(" ");
    const lines = runs(drawn).map((r) => ({ d: path(r.pts), forecast: r.forecast, pts: r.pts }));
    const zero = Y(0);
    const base = Y(Math.max(lo, 0));
    return {
      shown: shown.filter((p) => p.v != null),
      other: other.filter((p) => p.v != null),
      lines,
      compared: runs(within(compare?.points ?? []).map((p) => ({ ...p, forecast: false }))).map((r) => path(r.pts)),
      fills: fill
        ? lines.map(
            (l) =>
              `${l.d} L${Xd(l.pts[l.pts.length - 1].t).toFixed(1)} ${base.toFixed(1)} L${Xd(l.pts[0].t).toFixed(1)} ${base.toFixed(1)} Z`,
          )
        : [],
      areas: signed
        ? lines.map(
            (l) =>
              `${l.d} L${Xd(l.pts[l.pts.length - 1].t).toFixed(1)} ${zero.toFixed(1)} L${Xd(l.pts[0].t).toFixed(1)} ${zero.toFixed(1)} Z`,
          )
        : [],
      zero: lo < 0 && hi > 0 ? zero : null,
      Y,
      topOf: (v: number) => (Y(v) / H) * 100,
      leftOf: (t: number) => (X(t) / W) * 100,
    };
  }, [points, compare, start, end, domain, signed, fill, H]);

  const [hover, setHover] = useState<{ p: LinePoint; other: LinePoint | null } | null>(null);
  const range = useDragRange(start, end, onRange ?? (self ? own.zoom : undefined));
  const [width, setWidth] = useState(0);
  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth);
    const t = start + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (end - start);
    const near = (list: LinePoint[], within = Infinity) => {
      let best: LinePoint | null = null;
      for (const p of list) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      return best && Math.abs(best.t - t) <= within ? best : null;
    };
    // With a line to compare, the readings only count near the pointer (they stop at now; the other goes on).
    const p = near(chart.shown, compare ? 1800 : Infinity);
    const other = compare ? near(chart.other, 1800) : null;
    setHover(p || other ? { p: p ?? { t: other!.t, v: null }, other } : null);
  };

  const ticks = timeTicks(start, end, every);
  const nowLeft = now != null && now >= start && now <= end ? chart.leftOf(now) : null;

  // Zoomed in by itself, the way back out, over the plot's right.
  const out = self && own.zoomed && (
    <div className="flex justify-end">
      <ZoomOut from={start} to={end} onClick={own.reset} />
    </div>
  );

  if (!chart.shown.length && !chart.other.length && !chart.lines.length)
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {out}
        <div className="flex items-center justify-center text-sm text-ink-faint" style={{ height }}>
          {empty}
        </div>
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {out}
      <div
        className="relative cursor-crosshair touch-pan-y"
        style={{ height }}
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
        <div className="absolute inset-x-0 top-0 border-t border-fg/5" />
        <div className="absolute inset-x-0 top-1/2 border-t border-fg/5" />
        {spans.map((s) =>
          s.to > start && s.from < end ? (
            <div
              key={`${s.from}-${s.to}`}
              aria-hidden
              className="pointer-events-none absolute inset-y-0"
              style={{
                left: `${chart.leftOf(s.from)}%`,
                width: `${Math.max(0.3, chart.leftOf(s.to) - chart.leftOf(s.from))}%`,
                background: alpha(s.color, 0.12),
              }}
            />
          ) : null,
        )}
        {events.map((e) =>
          e.t >= start && e.t <= end ? (
            <span
              key={`e${e.t}`}
              title={e.label}
              className="absolute -top-1 z-1 size-2.5 -translate-x-1/2 cursor-help rounded-full ring-2 ring-surface"
              style={{ left: `${chart.leftOf(e.t)}%`, background: e.color }}
            />
          ) : null,
        )}
        {band && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-[3px]"
            style={{
              top: `${chart.topOf(band.to)}%`,
              height: `${chart.topOf(band.from) - chart.topOf(band.to)}%`,
              background: alpha(COLOR.good, 0.07),
            }}
          />
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full animate-reveal-x overflow-visible"
        >
          <defs>
            <clipPath id={`${clip}-plot`}>
              <rect x="0" y={-H} width={W} height={H * 3} />
            </clipPath>
          </defs>
          {signed && (
            <defs>
              <clipPath id={`${clip}-up`}>
                <rect x="0" y="0" width={W} height={Math.max(0, chart.Y(0))} />
              </clipPath>
              <clipPath id={`${clip}-down`}>
                <rect x="0" y={chart.Y(0)} width={W} height={Math.max(0, H - chart.Y(0))} />
              </clipPath>
            </defs>
          )}
          <g clipPath={`url(#${clip}-plot)`}>
            {signed &&
              chart.areas.map((d, i) => (
                <g key={`a${i}`}>
                  <path d={d} clipPath={`url(#${clip}-up)`} style={{ fill: alpha(signed.above, 0.22) }} />
                  <path d={d} clipPath={`url(#${clip}-down)`} style={{ fill: alpha(signed.below, 0.22) }} />
                </g>
              ))}
            {chart.fills.map((d, i) => (
              <path key={`f${i}`} d={d} style={{ fill: alpha(color, 0.14) }} />
            ))}
            {compare &&
              chart.compared.map((d, i) => (
                <path
                  key={`c${i}`}
                  d={d}
                  {...STROKE}
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  style={{ stroke: compare.color }}
                />
              ))}
            {chart.zero != null && (
              <line
                x1="0"
                x2={W}
                y1={chart.zero.toFixed(1)}
                y2={chart.zero.toFixed(1)}
                vectorEffect="non-scaling-stroke"
                style={{ stroke: alpha(COLOR.fg, 0.22) }}
              />
            )}
            {marks.map((m) => (
              <line
                key={m.label}
                x1="0"
                x2={W}
                y1={chart.Y(m.v).toFixed(1)}
                y2={chart.Y(m.v).toFixed(1)}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="3 4"
                style={{ stroke: m.color ?? alpha(COLOR.fg, 0.3) }}
              />
            ))}
            {chart.lines.map((l, i) =>
              signed ? (
                <g key={i}>
                  <path
                    d={l.d}
                    {...STROKE}
                    strokeWidth="2"
                    clipPath={`url(#${clip}-up)`}
                    style={{ stroke: signed.above }}
                  />
                  <path
                    d={l.d}
                    {...STROKE}
                    strokeWidth="2"
                    clipPath={`url(#${clip}-down)`}
                    style={{ stroke: signed.below }}
                  />
                </g>
              ) : (
                <path
                  key={i}
                  d={l.d}
                  {...STROKE}
                  strokeWidth="2"
                  strokeDasharray={l.forecast ? "4 4" : undefined}
                  strokeOpacity={l.forecast ? 0.75 : 1}
                  style={{ stroke: color }}
                />
              ),
            )}
          </g>
        </svg>
        {band?.label && (
          <span
            className="pointer-events-none absolute right-0 pt-0.5 text-[10.5px] text-ink-faint"
            style={{ top: `${chart.topOf(band.to)}%` }}
          >
            {band.label}
          </span>
        )}
        {marks.map((m) => (
          <span
            key={m.label}
            className="pointer-events-none absolute left-0 -translate-y-full pb-0.5 text-[10.5px] text-ink-faint"
            style={{ top: `${chart.topOf(m.v)}%` }}
          >
            {m.label}
          </span>
        ))}
        {nowLeft != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line-strong"
            style={{ left: `${nowLeft.toFixed(2)}%` }}
          >
            <span className="absolute -top-0.5 left-1.5 font-mono text-[10px] text-ink-faint">Now</span>
          </div>
        )}
        {hover && !range.dragging && (
          <>
            <HoverLine left={chart.leftOf(hover.p.t)} />
            {hover.p.v != null && (
              <span
                className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
                style={{
                  left: `${chart.leftOf(hover.p.t)}%`,
                  top: `${chart.topOf(hover.p.v)}%`,
                  background: signed ? (hover.p.v >= 0 ? signed.above : signed.below) : color,
                }}
              />
            )}
            {compare && hover.other?.v != null && (
              <span
                className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
                style={{
                  left: `${chart.leftOf(hover.other.t)}%`,
                  top: `${chart.topOf(hover.other.v)}%`,
                  background: compare.color,
                }}
              />
            )}
            <ChartTooltip left={chart.leftOf(hover.p.t)} flip={chart.leftOf(hover.p.t) > 60} width={width}>
              {tip(hover.p, hover.other)}
            </ChartTooltip>
          </>
        )}
      </div>
      <TimeTicks ticks={ticks} />
    </div>
  );
}
