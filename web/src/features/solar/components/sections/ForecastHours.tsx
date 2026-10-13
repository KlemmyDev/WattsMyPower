import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh, signedPct } from "~/features/common/formatting/utils/number";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import { ChartKey, dim, KeyItem, PickHead, usePick } from "~/features/solar/components/sections/PerformanceParts";
import { soFar, todayByHour, type HourPair } from "~/features/solar/utils/forecastSections";
import type { WeatherDay } from "~/features/weather/types";

/** "Ahead of the forecast" style chip: made against what was expected, while there's enough expected to compare. */
function vs(made: number | null, forecast: number | null) {
  if (made == null || forecast == null || forecast < 0.05) return undefined;
  const d = made / forecast - 1;
  return <Delta value={d}>{signedPct(d)} on forecast</Delta>;
}

/** What a picked hour's header says. */
function hourLine(p: HourPair): string {
  const span = `${hhmm(p.ts)}–${hhmm(p.ts + 3600)}`;
  const fc = p.forecast != null ? `forecast ${kWh(p.forecast)}` : "no forecast kept";
  if (p.made == null) return `${span}: ${fc}, ${p.done ? "no readings" : "still to come"}`;
  return `${span}: ${fc}, made ${kWh(p.made)}${p.done ? "" : " so far"}`;
}

/**
 * Today hour by hour: what this morning's forecast expected in each hour (an outline) against what the panels made in
 * it (filled). Pointing at an hour reads it out in the header; until then the header sums up the hours that are over.
 */
export function ForecastHours({
  weather,
  series,
  now,
}: {
  weather: WeatherDay | undefined;
  series: HistorySeries | undefined;
  now: number;
}) {
  const pick = usePick();
  const pairs = todayByHour(weather?.hours ?? [], series, now);
  if (!pairs.length) return null;
  const kept = pairs.some((p) => p.forecast != null);
  const top = Math.max(0.05, ...pairs.map((p) => Math.max(p.forecast ?? 0, p.made ?? 0)));
  const sum = soFar(pairs);
  const p = pick.picked != null ? pairs[pick.picked] : null;
  const madeToday = pairs.reduce((a, x) => a + (x.made ?? 0), 0);
  return (
    <Card aria-labelledby="h-fh">
      <PickHead
        id="h-fh"
        title="Today, hour by hour"
        sub={
          p
            ? hourLine(p)
            : !kept
              ? "No forecast was kept for this morning, so today's hours show what was made."
              : sum
                ? `This morning's forecast expected ${kWh(sum.forecast)} by now. You made ${kWh(sum.made)}.`
                : "This morning's forecast, hour by hour, filling in as the panels make it"
        }
        label={p ? hhmm(p.ts) : "Made so far"}
        value={p ? kWh(p.made ?? p.forecast) : kWh(madeToday)}
        chip={p ? vs(p.made, p.forecast) : sum ? vs(sum.made, sum.forecast) : undefined}
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex h-44 items-end gap-1.5 max-sm:h-36 max-sm:gap-[3px]" {...pick.plot}>
          {pairs.map((x, i) => (
            <button
              key={x.ts}
              type="button"
              {...pick.item(i)}
              aria-label={hourLine(x)}
              className={cn(
                "relative h-full min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0",
                dim(pick.picked, i),
              )}
            >
              {x.forecast != null && (
                <span
                  className="absolute inset-x-0 bottom-0 rounded-[5px] border-[1.5px] border-dashed max-sm:rounded-[3px] max-sm:border"
                  style={{
                    height: `${Math.max(1.5, (x.forecast / top) * 100).toFixed(1)}%`,
                    borderColor: alpha(COLOR.fg, 0.38),
                  }}
                />
              )}
              {x.made != null && (
                <span
                  className="absolute inset-x-[3px] bottom-0 rounded-[3px] transition-[height] duration-700 ease-out-soft max-sm:inset-x-px"
                  style={{
                    height: `${Math.max(1, (x.made / top) * 100).toFixed(1)}%`,
                    background: x.done ? COLOR.solar : alpha(COLOR.solar, 0.55),
                  }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 text-[11px] text-ink-faint tabular-nums max-sm:gap-[3px]">
          {pairs.map((x, i) => (
            <span
              key={x.ts}
              className={cn(
                "flex min-w-0 flex-1 justify-center whitespace-nowrap",
                i % 3 !== 0 && "invisible",
                i % 6 !== 0 && "max-sm:invisible",
              )}
            >
              {hhmm(x.ts)}
            </span>
          ))}
        </div>
      </div>
      <ChartKey>
        {kept && (
          <KeyItem
            swatch={
              <i
                className="size-3 rounded-[3px] border-[1.5px] border-dashed"
                style={{ borderColor: alpha(COLOR.fg, 0.45) }}
              />
            }
          >
            This morning's forecast
          </KeyItem>
        )}
        <KeyItem swatch={<i className="size-3 rounded-[3px] bg-solar" />}>What you made</KeyItem>
      </ChartKey>
    </Card>
  );
}
