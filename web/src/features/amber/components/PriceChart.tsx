import { useMemo, useState, type PointerEvent } from "react";
import type { AmberPrices, PriceInterval } from "~/features/amber/types";
import { intervalAt, priceLabel } from "~/features/amber/utils";
import { ChartTooltip, TooltipRow } from "~/features/common/ui/components/ChartHover";
import {
  DragBand,
  TimeTicks,
  timeTicks,
  useDragRange,
  useZoom,
  ZoomOut,
} from "~/features/common/ui/components/TimeLine";
import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH } from "~/features/common/formatting/utils/number";
import { addDays } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

const W = 1000;
const H = 160;
const PAD = 8;
// Buying follows the charts' home-use line (ink), feed-in their solar colour; both follow the theme.
export const BUY = COLOR.ink;
export const SELL = COLOR.solar;

const STROKE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/** Step lines for one channel: final prices solid, forecasts dashed, broken where there's no price. */
function steps(list: PriceInterval[], X: (t: number) => number, Y: (r: number) => number) {
  const out: { d: string; forecast: boolean }[] = [];
  let cur: { d: string; forecast: boolean } | null = null;
  let prev: PriceInterval | null = null;
  for (const p of list) {
    const forecast = !p.actual;
    const x0 = X(p.start).toFixed(1);
    const x1 = X(p.end).toFixed(1);
    const y = Y(p.rate).toFixed(1);
    const joined = prev !== null && prev.end === p.start;
    if (cur && joined && cur.forecast === forecast) {
      cur.d += ` V${y} H${x1}`;
    } else {
      if (cur) out.push(cur);
      // The forecast carries on from the last final price; after a gap in prices, start afresh.
      const from = joined && prev ? `M${x0} ${Y(prev.rate).toFixed(1)} V${y}` : `M${x0} ${y}`;
      cur = { d: `${from} H${x1}`, forecast };
    }
    prev = p;
  }
  if (cur) out.push(cur);
  return out;
}

/** The prices from `start` to `end` (the whole day, or a stretch of it zoomed into), scaled to fill the plot. A step
 * partly outside is cut off at the plot's edge. */
function plot(p: AmberPrices, start: number, end: number) {
  const within = (l: PriceInterval[]) => l.filter((x) => x.end > start && x.start < end);
  const buy = within(p.general);
  const sell = within(p.feed_in);
  const rates = [...buy, ...sell].map((x) => x.rate);
  const lo = Math.min(0, ...rates);
  const hi = Math.max(0.1, ...rates) * 1.08;
  const X = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / (end - start)) * W;
  const Y = (r: number) => H - PAD - ((r - lo) / (hi - lo)) * (H - 2 * PAD);
  return {
    buy,
    sell,
    buyPaths: steps(buy, X, Y),
    sellPaths: steps(sell, X, Y),
    zeroY: lo < 0 ? Y(0) : null,
    top: Math.max(...rates, 0),
    /** Where a price sits down the plot, as a percentage of its height. */
    topOf: (r: number) => (Y(r) / H) * 100,
    leftOf: (t: number) => (X(t) / W) * 100,
  };
}

const Dot = ({ left, top, color }: { left: number; top: number; color: string }) => (
  <span
    className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
    style={{ left: `${left}%`, top: `${top}%`, background: color }}
  />
);

/**
 * Today's import and feed-in prices from midnight to midnight, as step lines (each Amber interval
 * is one flat step), with the forecast dashed, now marked, and the interval under the pointer in a tooltip.
 * Dragging across it shows just that stretch, with a button back to the whole day.
 */
export function PriceChart({ prices, day, now }: { prices: AmberPrices; day: number; now: number }) {
  const end = addDays(day, 1);
  const zoom = useZoom(day, end);
  const { from, to } = zoom;
  const whole = useMemo(() => plot(prices, day, end), [prices, day, end]);
  const zoomed = useMemo(() => (zoom.zoomed ? plot(prices, from, to) : null), [prices, from, to, zoom.zoomed]);
  const chart = zoomed ?? whole;
  const range = useDragRange(from, to, zoom.zoom, {
    label: "Amber prices through the day, to buy and to sell",
    onReset: zoom.reset,
  });
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth); // layout px, as the tooltip is placed in (r is zoomed with the page)
    setHoverAt(from + Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * (to - from));
  };
  // Nothing's read off the chart while a stretch is dragged across.
  const at = range.dragging ? null : hoverAt;
  const buy = at != null ? intervalAt(chart.buy, at) : null;
  const sell = at != null ? intervalAt(chart.sell, at) : null;
  const shown = buy ?? sell;
  const nowLeft = now >= from && now < to ? chart.leftOf(now) : null;

  if (!whole.buy.length && !whole.sell.length) {
    return <div className="py-10 text-center text-sm text-ink-faint">No prices for today yet.</div>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-dim">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: BUY }} />
            Buying
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: SELL }} />
            Feed-in
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-3.5 border-t-2 border-dashed border-ink-muted" />
            Forecast
          </span>
        </span>
        <span className="flex items-center gap-3">
          {zoom.zoomed && <ZoomOut from={from} to={to} onClick={zoom.reset} />}
          <span className="tabular-nums">Up to {priceLabel(chart.top)}</span>
        </span>
      </div>
      <div
        className="relative h-[160px] cursor-crosshair touch-pan-y max-sm:h-[130px] compact:h-[120px]"
        {...range.keys}
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
        onPointerLeave={() => setHoverAt(null)}
      >
        <DragBand band={range.band} />
        <div className="absolute inset-x-0 top-0 border-t border-fg/5" />
        <div className="absolute inset-x-0 top-1/2 border-t border-fg/5" />
        {shown && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 rounded-[3px] bg-fg/8"
            style={{
              left: `${chart.leftOf(shown.start).toFixed(3)}%`,
              width: `max(3px, ${(chart.leftOf(shown.end) - chart.leftOf(shown.start)).toFixed(3)}%)`,
            }}
          />
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full animate-reveal-x overflow-visible"
        >
          {chart.zeroY != null && (
            <line
              x1="0"
              x2={W}
              y1={chart.zeroY.toFixed(1)}
              y2={chart.zeroY.toFixed(1)}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.22) }}
            />
          )}
          {chart.sellPaths.map((s, i) => (
            <path
              key={`s${i}`}
              d={s.d}
              {...STROKE}
              strokeWidth="2"
              strokeDasharray={s.forecast ? "4 4" : undefined}
              strokeOpacity={s.forecast ? 0.75 : 1}
              style={{ stroke: SELL }}
            />
          ))}
          {chart.buyPaths.map((s, i) => (
            <path
              key={`b${i}`}
              d={s.d}
              {...STROKE}
              strokeWidth="2"
              strokeDasharray={s.forecast ? "4 4" : undefined}
              strokeOpacity={s.forecast ? 0.75 : 1}
              style={{ stroke: BUY }}
            />
          ))}
        </svg>
        {chart.zeroY != null && (
          <span
            className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 font-mono text-[10px] text-ink-faint"
            style={{ top: `${((chart.zeroY / H) * 100).toFixed(2)}%` }}
          >
            0c
          </span>
        )}
        {nowLeft != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-line-strong"
            style={{ left: `${nowLeft.toFixed(2)}%` }}
          >
            <span className="absolute -top-0.5 left-1.5 font-mono text-[10px] text-ink-faint">Now</span>
          </div>
        )}
        {at != null && buy && <Dot left={chart.leftOf(at)} top={chart.topOf(buy.rate)} color={BUY} />}
        {at != null && sell && <Dot left={chart.leftOf(at)} top={chart.topOf(sell.rate)} color={SELL} />}
        {at != null && shown && (
          <ChartTooltip left={chart.leftOf(at)} flip={chart.leftOf(at) > 60} width={width}>
            <span className="flex items-center justify-between font-medium text-ink">
              {hhmm(shown.start)} to {hhmm(shown.end)}
              {!shown.actual && <span className="text-[11px] font-normal text-ink-faint">Forecast</span>}
            </span>
            <TooltipRow label="Buying" value={buy ? priceLabel(buy.rate) : DASH} color={BUY} />
            <TooltipRow label="Feed-in" value={sell ? priceLabel(sell.rate) : DASH} color={SELL} />
            {sell && sell.rate < 0 && (
              <span className="text-xs text-ink-faint">Sending power to the grid costs you</span>
            )}
          </ChartTooltip>
        )}
      </div>
      <TimeTicks ticks={timeTicks(from, to, 3)} />
    </div>
  );
}
