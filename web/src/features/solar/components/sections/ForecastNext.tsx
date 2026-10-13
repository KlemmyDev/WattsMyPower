import type { CSSProperties } from "react";
import { hhmm, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Card, Footnote } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy, ForecastDay, ForecastHour } from "~/features/common/weather/types";
import { codeIcon, codeName, degrees, hourIconColor } from "~/features/common/weather/utils";
import { dim, PickHead, usePick } from "~/features/solar/components/sections/PerformanceParts";
import { bestHours, hoursOf } from "~/features/solar/utils/forecastSections";

type Row = {
  day: ForecastDay;
  name: string;
  hours: ForecastHour[];
  best: string | null;
  likely: { low: number; high: number } | null;
};

/** Each day of the outlook with its hours, its best hours and the range it likely lands in. */
function rowsOf(f: Forecast, acc: ForecastAccuracy | null | undefined, now: number): Row[] {
  const today = dateKey(now);
  const tomorrow = dateKey(addDays(midnight(now), 1));
  const range = acc?.range;
  // Today's row only while there's still some sun to come.
  return f.days.flatMap((d) => {
    if (d.date === today && d.pv_kwh < 0.05) return [];
    const hours = hoursOf(f.hours, d.start, addDays(d.start, 1));
    return [
      {
        day: d,
        name: d.date === today ? "Rest of today" : d.date === tomorrow ? "Tomorrow" : shortDay.format(parseYmd(d.date)),
        hours,
        best: bestHours(hours),
        likely: range && d.pv_kwh > 0.1 ? { low: d.pv_kwh * range.low, high: d.pv_kwh * range.high } : null,
      },
    ];
  });
}

/** "12–17 kWh": a likely range, the unit once. */
const between = (r: { low: number; high: number }) =>
  r.high < 1 ? `${kWh(r.low)}–${kWh(r.high)}` : `${r.low.toFixed(r.high < 10 ? 1 : 0)}–${kWh(r.high)}`;

/** A day's range and best hours in a line: "Likely 12–17 kWh · best 10:00–14:00". */
function rowLine(r: Row): string | null {
  const parts: string[] = [];
  if (r.likely) parts.push(`Likely ${between(r.likely)}`);
  if (r.best) parts.push(`${parts.length ? "best" : "Best"} ${r.best}`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A day's forecast hour by hour, as bars on the same scale for every day so the days compare. The best hours are full
 * solar; the rest are softer.
 */
function DayCurve({ row, top }: { row: Row; top: number }) {
  const lit = row.hours.filter((h) => h.pv_kw > 0.02);
  if (!lit.length)
    return <div className="flex h-24 items-center text-[13px] text-ink-faint">Next to no solar expected.</div>;
  const from = row.hours.indexOf(lit[0]);
  const to = row.hours.indexOf(lit[lit.length - 1]);
  const hours = row.hours.slice(from, to + 1);
  const peak = Math.max(...hours.map((h) => h.pv_kw));
  return (
    <div aria-hidden className="flex flex-col gap-1.5">
      <div className="flex h-24 items-end gap-1">
        {hours.map((h, i) => (
          <i
            key={h.ts}
            className="bar-grow block min-w-0 flex-1 rounded-[3px_3px_1px_1px]"
            style={
              {
                height: `${Math.max(2, (h.pv_kw / top) * 100).toFixed(1)}%`,
                background: h.pv_kw >= 0.75 * peak ? COLOR.solar : alpha(COLOR.solar, 0.4),
                "--i": i,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-ink-faint tabular-nums">
        <span>{hhmm(hours[0].ts)}</span>
        <span>{hhmm(hours[hours.length - 1].ts + 3600)}</span>
      </div>
    </div>
  );
}

/**
 * The days ahead: a row each with the sky, the solar the forecast expects, the range it likely lands in and the best
 * hours to run things. Pointing at a day shows its hours in the panel at the top (tomorrow until then).
 */
export function ForecastNext({ f, acc, now }: { f: Forecast; acc: ForecastAccuracy | null | undefined; now: number }) {
  const fahrenheit = useFahrenheit();
  const pick = usePick();
  const rows = rowsOf(f, acc, now);
  if (!rows.length) return null;
  const tomorrow = dateKey(addDays(midnight(now), 1));
  const fallback = Math.max(
    0,
    rows.findIndex((r) => r.day.date === tomorrow),
  );
  const at = pick.picked ?? fallback;
  const row = rows[at];
  const top = Math.max(0.1, ...f.hours.map((h) => h.pv_kw));
  return (
    <Card aria-labelledby="h-fn">
      <PickHead
        id="h-fn"
        title="Next days"
        sub={rowLine(row) ?? "What the forecast expects, day by day"}
        label={row.name}
        value={kWh(row.day.pv_kwh)}
      />
      <DayCurve row={row} top={top} />
      <ul className="m-0 flex list-none flex-col p-0" {...pick.plot}>
        {rows.map((r, i) => {
          const icon = r.day.code != null ? codeIcon(r.day.code, true) : null;
          return (
            <li key={r.day.date} className="border-t border-line-subtle first:border-t-0">
              <button
                type="button"
                {...pick.item(i)}
                aria-pressed={i === at}
                aria-label={`${r.name}: ${kWh(r.day.pv_kwh)}${r.likely ? `, likely ${between(r.likely)}` : ""}${r.day.code != null ? `, ${codeName(r.day.code)}` : ""}${r.best ? `, best ${r.best}` : ""}`}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-0 py-3 text-left text-ink",
                  dim(pick.picked, i),
                )}
              >
                <span
                  aria-hidden
                  className={cn("h-8 w-1 shrink-0 rounded-full", i === at ? "bg-solar" : "bg-transparent")}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-pretty text-ink-faint tabular-nums">
                    {rowLine(r) ?? "Little sun expected"}
                  </span>
                </span>
                {icon && (
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-muted">
                    <Icon name={icon} size={16} style={{ color: hourIconColor(icon) }} />
                    <span className="max-md:hidden">{codeName(r.day.code!)}</span>
                    {r.day.temp_max != null && (
                      <span className="text-ink-faint">{degrees(r.day.temp_max, fahrenheit)}</span>
                    )}
                  </span>
                )}
                <span className="w-[76px] shrink-0 text-right text-[17px] font-light tabular-nums">
                  {kWh(r.day.pv_kwh)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Footnote>
        {acc?.range
          ? `The likely range is where 8 in 10 of the last ${acc.range.days} days landed against their forecast. The forecast reaches two days ahead.`
          : "A likely range shows once the forecast has a week of days to check itself against. The forecast reaches two days ahead."}
      </Footnote>
    </Card>
  );
}
