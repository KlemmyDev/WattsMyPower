import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import { COLOR, heatColor } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import { EXPECTED, SOLAR } from "~/features/solar/components/parts";
import type { SolarInsights } from "~/features/solar/types";
import { pastDays } from "~/features/solar/utils";

/**
 * The last days (up to 30) as a strip of cells, the brighter the more the panels made, with the figures that sum them
 * up beside it: the average, the best and lowest days, how far out the forecast was and how they did against the
 * weather.
 */
export function SolarDays({
  acc,
  performance,
  now,
}: {
  acc: ForecastAccuracy | null | undefined;
  performance: SolarInsights["performance"] | undefined;
  now: number;
}) {
  const days = pastDays(acc, performance, now);
  const { hover: h, width, plot, bar } = useBarHover();
  if (!days.length) return null;
  const kwh = days.map((d) => d.kwh);
  const max = Math.max(...kwh);
  const min = Math.min(...kwh);
  const total = kwh.reduce((a, v) => a + v, 0);
  const rated = (performance?.days ?? []).filter((d) => d.ratio != null);
  const weather = rated.length ? rated.reduce((a, d) => a + d.ratio!, 0) / rated.length : null;
  const figures: [string, string][] = [
    ["Average", kWh(total / days.length)],
    ["Best", kWh(max)],
    ["Lowest", kWh(min)],
    ["Forecast out by", acc?.mae_kwh != null ? kWh(acc.mae_kwh) : DASH],
    ["Of what the weather allowed", weather != null ? pct(weather * 100) : DASH],
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <TitleBlock title={`Last ${days.length} days`} sub={`${kWh(total)} in all`} />
        <dl className="flex flex-wrap gap-x-7 gap-y-2">
          {figures.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[11.5px] text-ink-faint">{k}</dt>
              <dd className="text-[17px] font-light tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          className="relative grid gap-1 max-sm:gap-0.5"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          {...plot}
        >
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              {...bar(i)}
              aria-label={`${shortDay.format(parseYmd(d.date))}: ${kWh(d.kwh)}`}
              className={cn(
                "h-11 rounded-md border-0 p-0 transition-[scale,opacity] duration-200 max-sm:h-8 max-sm:rounded-[3px]",
                h === i && "scale-y-110",
                h != null && h !== i && "opacity-60",
              )}
              style={{ background: heatColor(COLOR.solar, max > min ? (d.kwh - min) / (max - min) : 1) }}
            />
          ))}
          {h != null && (
            <ChartTooltip
              left={((h + 0.5) / days.length) * 100}
              flip={h > days.length / 2}
              width={width}
              className="top-auto bottom-full mb-2"
            >
              <span className="font-medium text-ink">{shortDay.format(parseYmd(days[h].date))}</span>
              <TooltipRow label="Made" value={kWh(days[h].kwh)} color={SOLAR} />
              {days[h].forecast != null && (
                <TooltipRow label="Forecast" value={kWh(days[h].forecast)} color={EXPECTED} />
              )}
              {days[h].ratio != null && (
                <TooltipRow label="Of what the weather allowed" value={pct(days[h].ratio! * 100)} />
              )}
            </ChartTooltip>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-ink-faint">
          <span>{shortDay.format(parseYmd(days[0].date))}</span>
          <span className="flex items-center gap-1.5">
            Less
            {[0, 0.33, 0.66, 1].map((k) => (
              <i key={k} className="size-2.5 rounded-[3px]" style={{ background: heatColor(COLOR.solar, k) }} />
            ))}
            More
          </span>
          <span>{shortDay.format(parseYmd(days[days.length - 1].date))}</span>
        </div>
      </div>
    </Card>
  );
}
