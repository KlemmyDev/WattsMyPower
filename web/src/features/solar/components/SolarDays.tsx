import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import { COLOR, heatColor } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import { usePick } from "~/features/common/ui/components/Pick";
import { cn } from "~/features/common/ui/utils";
import type { ForecastAccuracy } from "~/features/common/weather/types";
import type { SolarInsights } from "~/features/solar/types";
import { pastDays } from "~/features/solar/utils";

/**
 * The last days (up to 30) as bars, the taller the more the panels made, with the average as a line across them and
 * the day and its figure under each. The figures that sum them up stay in the header, and the row under it always
 * holds the same height: pointing at a day fills it with that day's details instead of replacing the header, so the
 * card doesn't empty out or move under the pointer.
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
  const { picked: h, plot, item } = usePick();
  if (!days.length) return null;
  const kwh = days.map((d) => d.kwh);
  const max = Math.max(...kwh);
  const min = Math.min(...kwh);
  const total = kwh.reduce((a, v) => a + v, 0);
  const average = total / days.length;
  const rated = (performance?.days ?? []).filter((d) => d.ratio != null);
  const weather = rated.length ? rated.reduce((a, d) => a + d.ratio!, 0) / rated.length : null;
  const best = days.find((d) => d.kwh === max)!;
  const lowest = days.find((d) => d.kwh === min)!;
  const above = days.filter((d) => d.kwh >= average).length;
  const figures: [string, string, string?][] = [
    ["Average", kWh(average), `${days.length} days`],
    ["Best", kWh(max), shortDay.format(parseYmd(best.date))],
    ["Lowest", kWh(min), shortDay.format(parseYmd(lowest.date))],
    ["Above average", `${above} of ${days.length}`, "days that beat the average"],
    ["Usually off by", acc?.mae_kwh != null ? kWh(acc.mae_kwh) : DASH, "a day, the forecast"],
    ["Of what the sun allowed", weather != null ? pct(weather * 100) : DASH, "panels against the weather"],
  ];
  const cols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  const avgLine = `${(average / max) * 100}%`;
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <TitleBlock title={`Last ${days.length} days`} sub={`${kWh(total)} in all · hover or tap a bar for its day`} />
        <dl className="flex w-full flex-wrap gap-2">
          {figures.map(([k, v, note]) => (
            <div key={k} className="flex flex-col gap-1 rounded-2xl bg-fg/5 px-4 py-3">
              <dt className="text-xs text-ink-faint">{k}</dt>
              <dd className="text-lg font-light whitespace-nowrap tabular-nums">{v}</dd>
              {note && <span className="text-xs text-ink-muted">{note}</span>}
            </div>
          ))}
        </dl>
      </div>
      <div className="flex h-12 items-center" aria-live="polite">
        {h != null ? (
          <div className="flex w-full min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[17px] font-light tabular-nums">
                {`${shortDay.format(parseYmd(days[h].date))}: ${kWh(days[h].kwh)}`}
              </span>
              <span className="hidden truncate text-[13px] text-ink-muted sm:block">
                {[
                  days[h].forecast != null ? `Forecast ${kWh(days[h].forecast)}` : null,
                  days[h].ratio != null ? `${pct(days[h].ratio! * 100)} of what the sun allowed` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <Delta value={days[h].kwh / average - 1}>{`${pct(Math.abs(days[h].kwh / average - 1) * 100)} ${
              days[h].kwh >= average ? "above" : "below"
            } average`}</Delta>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <div className="relative flex h-44 items-end gap-1.5 max-sm:h-36 max-sm:gap-[3px]" {...plot}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-1 border-t border-dashed border-ink-soft"
            style={{ bottom: avgLine }}
          />
          {days.map((d, i) => {
            const share = max > 0 ? d.kwh / max : 0;
            return (
              <button
                key={d.date}
                type="button"
                {...item(i)}
                aria-label={`${shortDay.format(parseYmd(d.date))}: ${kWh(d.kwh)}`}
                title={`${shortDay.format(parseYmd(d.date))}: ${kWh(d.kwh)}`}
                className={cn(
                  "relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end border-0 bg-transparent p-0 transition-opacity duration-200",
                  h != null && h !== i && "opacity-40",
                )}
              >
                <span
                  className="absolute inset-x-0 text-center text-[12px] leading-none font-semibold text-ink tabular-nums max-sm:text-[10px]"
                  style={{ bottom: `calc(${share * 100}% + 4px)` }}
                >
                  {Math.round(d.kwh)}
                </span>
                <span
                  className="block w-full rounded-t-md transition-[height] duration-500"
                  style={{
                    height: `${share * 100}%`,
                    background: heatColor(COLOR.solar, max > min ? (d.kwh - min) / (max - min) : 1),
                  }}
                />
              </button>
            );
          })}
        </div>
        <div className="grid gap-1.5 max-sm:gap-[3px]" style={cols}>
          {days.map((d) => (
            <span
              key={d.date}
              className="truncate text-center text-[11px] font-medium text-ink-muted tabular-nums max-sm:text-[9px]"
            >
              {parseYmd(d.date).getDate()}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
