import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { hourLabel, minutesLabel } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import type { Tariff } from "~/features/common/tariffs/types";
import { bandColor, bandTable, tariffNumber, type DayKind } from "~/features/common/tariffs/utils";
import { useNow } from "~/features/common/time/hooks";
import { partsOf } from "~/features/common/time/utils";
import { ChartTooltip, HoverLine, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Swatch } from "~/features/common/ui/components/Swatch";

const DAY = 1440;
const TICKS = [0, 6, 12, 18, 24];
const c = (v: number) => `${+(v * 100).toFixed(1)}c`;

/** Runs of minutes in the same band: [start, end, band index]. */
function runs(tab: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let start = 0;
  for (let m = 1; m <= DAY; m++)
    if (m === DAY || tab[m] !== tab[start]) {
      out.push([start, m, tab[start]]);
      start = m;
    }
  return out;
}

/**
 * The rates through a day as a step chart: what grid power costs at each time (each rate's stretch filled in its
 * colour), and feed-in as a dashed line under it, the time now marked. Weekdays or weekends, when they differ. Hovering
 * says the rate in force then. Drawn from the rates as they're being edited.
 */
export function RatesDayChart({ tariff }: { tariff: Tariff }) {
  const now = useNow(60_000);
  const p = partsOf(now);
  const weekend = p.weekday === 0 || p.weekday === 6;
  const differs =
    tariff.type === "tou" && bandTable(tariff, "weekday").tab.join() !== bandTable(tariff, "weekend").tab.join();
  const [kind, setKind] = useState<DayKind>(weekend ? "weekend" : "weekday");
  const shown = differs ? kind : weekend ? "weekend" : "weekday";
  const flat = tariff.type !== "tou";
  const { bands, tab } = flat
    ? {
        bands: [{ name: tariff.type === "amber" ? "Fallback" : "Any time", rate: tariff.flat_rate, windows: [] }],
        tab: new Array<number>(DAY).fill(0),
      }
    : bandTable(tariff, shown);
  const feedIn = tariffNumber(tariff.feed_in_rate);
  const rates = bands.map((b) => tariffNumber(b.rate));
  const top = Math.max(...rates, feedIn, 0.05) * 1.18;
  const segs = runs(tab);

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(Math.max(Math.round(((e.clientX - r.left) / r.width) * DAY), 0), DAY - 1));
  };

  const y = (v: number) => 100 - (v / top) * 100;
  const nowMin = p.hour * 60 + p.minute;
  const hb = hover != null ? bands[tab[hover]] : null;
  const run = hover != null ? segs.find(([a, b]) => hover >= a && hover < b) : null;
  const color = (i: number) => (flat ? COLOR.import : bandColor(i));

  return (
    <div className="flex flex-col gap-3">
      {differs && (
        <Segmented
          label="Which days"
          options={[
            { value: "weekday", label: "Weekdays" },
            { value: "weekend", label: "Weekends" },
          ]}
          value={kind}
          onChange={setKind}
          className="w-fit"
          buttonClassName="px-3.5 py-1.5 text-[13px]"
        />
      )}
      <div
        ref={box}
        className="relative h-[200px] touch-pan-y"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox="0 0 1440 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          role="img"
          aria-label="Your rates through the day"
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={DAY}
              y1={y(top * f)}
              y2={y(top * f)}
              stroke={COLOR.gridLine}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {segs.map(([a, b, i]) => {
            const r = tariffNumber(bands[i].rate);
            return (
              <g key={a}>
                <rect
                  x={a}
                  y={y(r)}
                  width={b - a}
                  height={100 - y(r)}
                  fill={alpha(color(i), hover != null && run?.[0] === a ? 0.4 : 0.24)}
                />
                <line
                  x1={a}
                  x2={b}
                  y1={y(r)}
                  y2={y(r)}
                  stroke={color(i)}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {/* The steps between rates. */}
          {segs.slice(1).map(([a, , i], k) => (
            <line
              key={a}
              x1={a}
              x2={a}
              y1={y(tariffNumber(bands[segs[k][2]].rate))}
              y2={y(tariffNumber(bands[i].rate))}
              stroke={COLOR.gridLine}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {feedIn > 0 && (
            <line
              x1="0"
              x2={DAY}
              y1={y(feedIn)}
              y2={y(feedIn)}
              stroke={COLOR.export}
              strokeWidth="2"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Now, on today's kind of day. */}
        {shown === (weekend ? "weekend" : "weekday") && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 border-l border-ink/50"
            style={{ left: `${(nowMin / DAY) * 100}%` }}
          >
            <span className="absolute -top-0.5 left-1 rounded-full bg-ink px-1.5 py-px text-[10px] font-semibold text-ink-inverse">
              Now
            </span>
          </div>
        )}
        {[0.5, 1].map((f) => (
          <span
            key={f}
            className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 text-[10px] text-ink-faint tabular-nums"
            style={{ top: `${y((top / 1.18) * f)}%` }}
          >
            {c((top / 1.18) * f)}
          </span>
        ))}
        {hover != null && hb && run && (
          <>
            <HoverLine left={(hover / DAY) * 100} />
            <ChartTooltip left={(hover / DAY) * 100} flip={hover > DAY / 2} width={width}>
              <span className="font-semibold">
                {minutesLabel(run[0])} to {minutesLabel(run[1] % DAY)}
              </span>
              <TooltipRow label={hb.name} value={`${c(tariffNumber(hb.rate))}/kWh`} color={color(tab[hover])} />
              {feedIn > 0 && <TooltipRow label="Feed-in" value={`${c(feedIn)}/kWh`} color={COLOR.export} />}
            </ChartTooltip>
          </>
        )}
      </div>
      <div className="relative h-3.5">
        {TICKS.map((hr, i) => (
          <span
            key={hr}
            className={`absolute text-[11px] text-ink-faint tabular-nums ${i === 0 ? "" : i === TICKS.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${(hr / 24) * 100}%` }}
          >
            {hourLabel(hr)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-muted">
        {bands.map((b, i) =>
          flat || tab.includes(i) ? (
            <span key={i} className="flex items-center gap-1.5 tabular-nums">
              <Swatch color={color(i)} size={10} />
              {b.name} · {c(tariffNumber(b.rate))}
            </span>
          ) : null,
        )}
        {feedIn > 0 && (
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: COLOR.export }} />
            Feed-in · {c(feedIn)}
          </span>
        )}
      </div>
    </div>
  );
}
