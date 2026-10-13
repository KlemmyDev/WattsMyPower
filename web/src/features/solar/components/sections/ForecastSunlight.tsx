import { useQuery } from "@tanstack/react-query";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { dateKey, fromDateKey } from "~/features/common/time/utils";
import { Card, Footnote } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { dim, PickHead, usePick } from "~/features/solar/components/sections/PerformanceParts";
import type { SolarInsights } from "~/features/solar/types";
import { weatherDaysQuery } from "~/features/weather/api";

type Dot = { date: string; sun: number; made: number };

/** The days before today with both a sunlight figure and what was made: from the forecast's record, else performance. */
function dotsOf(
  acc: ForecastAccuracy | null | undefined,
  performance: SolarInsights["performance"],
  sunlight: Map<string, number>,
  today: string,
): Dot[] {
  const made = acc?.days.length
    ? acc.days.map((d) => ({ date: d.date, kwh: d.actual_kwh as number | null }))
    : (performance?.days ?? []).map((d) => ({ date: d.date, kwh: d.actual_kwh }));
  return made.flatMap((d) => {
    const sun = sunlight.get(d.date);
    return d.date < today && d.kwh != null && sun != null && sun > 0.1 ? [{ date: d.date, sun, made: d.kwh }] : [];
  });
}

/**
 * Sunlight to solar: each of the last days as a dot of the sunlight that fell (kWh/m² on flat ground) against what the
 * panels made, with the line the Performance figures are learned from through them. Days well below the line lost
 * something (cloud passing at the wrong time, dust, the inverter's limit). Left out until there are a few days.
 */
export function ForecastSunlight({
  acc,
  performance: P,
  now,
}: {
  acc: ForecastAccuracy | null | undefined;
  performance: SolarInsights["performance"];
  now: number;
}) {
  const today = dateKey(now);
  const first = acc?.days[0]?.date ?? P?.days[0]?.date ?? today;
  const { data } = useQuery(weatherDaysQuery(first, today));
  const pick = usePick();
  const k = P?.kwh_per_kwh_m2;
  const sunlight = new Map(
    (data ?? []).flatMap((d) => (d.sunlight_kwh_m2 != null ? [[d.date, d.sunlight_kwh_m2] as const] : [])),
  );
  const dots = dotsOf(acc, P, sunlight, today);
  if (!k || dots.length < 5) return null;
  const xTop = Math.max(...dots.map((d) => d.sun)) * 1.08;
  const yTop = Math.max(...dots.map((d) => d.made), k * xTop * 0.6) * 1.08;
  // The line runs from nothing to the brightest edge, or to the top of the chart if it gets there first.
  const xEnd = Math.min(xTop, yTop / k);
  const d = pick.picked != null ? dots[pick.picked] : null;
  const share = d ? d.made / (k * d.sun) : null;
  return (
    <Card aria-labelledby="h-fs">
      <PickHead
        id="h-fs"
        title="Sunlight to solar"
        sub={
          d
            ? `${d.sun.toFixed(1)} kWh/m² of sunlight, ${kWh(d.made)} made`
            : `About ${k.toFixed(1)} kWh for every kWh/m² of sunlight. Days below the line lost something.`
        }
        label={d ? dayMonth(fromDateKey(d.date)) : "Each kWh/m²"}
        value={d ? kWh(d.made) : kWh(k)}
        chip={share != null ? <Delta value={share - 1}>{`${signedPct(share - 1)} on the line`}</Delta> : undefined}
      />
      <div className="flex gap-2">
        <div className="flex flex-col justify-between pb-5 text-right text-[11px] text-ink-faint tabular-nums">
          <span>{Math.round(yTop)}</span>
          <span>0</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="relative h-52 border-b border-l border-line max-sm:h-44" {...pick.plot}>
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              <line
                x1={0}
                y1={100}
                x2={(xEnd / xTop) * 100}
                y2={100 - ((k * xEnd) / yTop) * 100}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: alpha(COLOR.good, 0.7) }}
              />
            </svg>
            {dots.map((x, i) => (
              <button
                key={x.date}
                type="button"
                {...pick.item(i)}
                aria-label={`${dayMonth(fromDateKey(x.date))}: ${x.sun.toFixed(1)} kWh/m² of sunlight, ${kWh(x.made)} made, ${pct((x.made / (k * x.sun)) * 100)} of the line`}
                className={cn(
                  "absolute flex size-5 -translate-x-1/2 translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0",
                  dim(pick.picked, i),
                )}
                style={{ left: `${(x.sun / xTop) * 100}%`, bottom: `${(x.made / yTop) * 100}%` }}
              >
                <i
                  className={cn("block rounded-full", pick.picked === i ? "size-3" : "size-2")}
                  style={{ background: i === dots.length - 1 ? COLOR.solar : alpha(COLOR.solar, 0.6) }}
                />
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-ink-faint tabular-nums">
            <span>0</span>
            <span>{`${xTop.toFixed(1)} kWh/m²`}</span>
          </div>
        </div>
      </div>
      <Footnote>
        Up the side is kWh made; along the bottom, sunlight on flat ground. The line doesn't stop at the inverter's
        limit, so the brightest days can sit a little under it.
      </Footnote>
    </Card>
  );
}
