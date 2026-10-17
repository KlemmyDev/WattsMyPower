import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { energyToday } from "~/features/common/energy/utils";
import { parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { addDays, isWeekend, midnight } from "~/features/common/time/utils";
import { Breakdown } from "~/features/common/ui/components/Breakdown";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import { dailyQuery } from "~/features/history/api";
import { buildDays, hasData, type DataDay } from "~/features/history/utils/year";
import { sourcesOf, SOURCES } from "~/features/home/utils/today";

/**
 * Where the house's power came from today (solar straight from the panels, the battery, the grid), and how much of it
 * the house made itself today and over the last 30 days.
 */
export function HomeSourcesCard({
  series,
  p,
  days,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  days: DataDay[];
}) {
  const s = sourcesOf(series);
  const home = energyToday(p)?.home ?? s.solar + s.battery + s.grid;
  const sum = s.solar + s.battery + s.grid;
  // The split is from the readings; the total is what the counters say.
  const k = sum > 0 ? home / sum : 0;
  const parts = [
    { key: "solar", label: "Solar, straight from the panels", kwh: s.solar * k, color: SOURCES.solar },
    { key: "battery", label: "The battery", kwh: s.battery * k, color: SOURCES.battery },
    { key: "grid", label: "The grid", kwh: s.grid * k, color: SOURCES.grid },
  ];
  const self = home > 0 ? 1 - (s.grid * k) / home : null;
  const whole = days.filter((d) => !d.partial);
  const month = whole.length
    ? whole.reduce((a, d) => a + d.home * d.ss, 0) /
      Math.max(
        0.01,
        whole.reduce((a, d) => a + d.home, 0),
      )
    : null;
  return (
    <Card>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock className="min-w-0 flex-1" title="Where it came from" sub="Today's home use so far" />
        {self != null && (
          <div className="flex flex-none flex-col items-end gap-0.5">
            <span className="text-xs text-ink-faint">Self-sufficiency</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{pct(self * 100)}</span>
          </div>
        )}
      </div>
      {home > 0 ? (
        <Breakdown parts={parts} total={home} />
      ) : (
        <div className="text-[13px] text-ink-faint">No home use recorded yet today.</div>
      )}
      {month != null && (
        <div className="text-xs text-ink-faint">
          {pct(month * 100)} self-powered over the last {whole.length} {whole.length === 1 ? "day" : "days"}.
        </div>
      )}
    </Card>
  );
}

/**
 * The last 30 days of home use, each day stacked by where it came from, with the usual weekday and weekend day, and
 * the biggest day.
 */
export function HomeDaysCard({ days }: { days: DataDay[] }) {
  const whole = days.filter((d) => !d.partial);
  const { hover: h, width, plot, bar } = useBarHover();
  if (!whole.length) return null;
  const top = Math.max(1, ...whole.map((d) => d.home)) * 1.05;
  const avg = (list: DataDay[]) => (list.length ? list.reduce((a, d) => a + d.home, 0) / list.length : null);
  const weekend = (d: DataDay) => isWeekend(d.ts);
  const weekdays = avg(whole.filter((d) => !weekend(d)));
  const weekends = avg(whole.filter(weekend));
  const biggest = whole.reduce((a, d) => (d.home > a.home ? d : a), whole[0]);
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title={`Last ${whole.length} days`}
          sub={`${kWh(avg(whole))} a day · biggest ${kWh(biggest.home)} on ${shortDay.format(parseYmd(biggest.key))}`}
        />
        <div className="flex gap-6">
          {[
            ["A weekday", weekdays],
            ["A weekend day", weekends],
          ].map(([label, v]) => (
            <div key={label as string} className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-ink-faint">{label}</span>
              <span className="text-[22px] leading-7 font-light tabular-nums">
                {v != null ? kWh(v as number) : DASH}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative flex h-32 items-end gap-1 max-sm:gap-0.5" {...plot}>
          {whole.map((d, i) => (
            // The day's column, the full height of the chart, so a small day is as easy to point at as a big one.
            <button
              key={d.key}
              type="button"
              {...bar(i)}
              aria-label={`${shortDay.format(parseYmd(d.key))}: ${kWh(d.home)} (solar ${kWh(d.direct)}, battery ${kWh(d.battery)}, grid ${kWh(d.imp)})`}
              className={cn(
                "flex h-full min-w-0 flex-1 cursor-pointer items-end border-0 bg-transparent p-0 transition-opacity duration-200",
                h != null && h !== i && "opacity-45",
              )}
            >
              <span
                className="bar-grow flex w-full flex-col-reverse overflow-hidden rounded-[4px_4px_2px_2px]"
                style={{ height: `${(d.home / top) * 100}%`, "--i": i } as CSSProperties}
              >
                {[
                  [d.direct, SOURCES.solar],
                  [d.battery, SOURCES.battery],
                  [Math.max(0, d.home - d.direct - d.battery), SOURCES.grid],
                ].map(([v, c], k) => (
                  <i
                    key={k}
                    className="block w-full flex-none"
                    style={{ height: `${d.home ? ((v as number) / d.home) * 100 : 0}%`, background: c as string }}
                  />
                ))}
              </span>
            </button>
          ))}
          {h != null && (
            <ChartTooltip left={((h + 0.5) / whole.length) * 100} flip={h > whole.length / 2} width={width}>
              <span className="font-medium text-ink">{shortDay.format(parseYmd(whole[h].key))}</span>
              <TooltipRow label="Solar" value={kWh(whole[h].direct)} color={SOURCES.solar} />
              <TooltipRow label="Battery" value={kWh(whole[h].battery)} color={SOURCES.battery} />
              <TooltipRow
                label="Grid"
                value={kWh(Math.max(0, whole[h].home - whole[h].direct - whole[h].battery))}
                color={SOURCES.grid}
              />
              <TooltipRow label="Home used" value={kWh(whole[h].home)} />
              <TooltipRow label="Self-sufficiency" value={pct(whole[h].ss * 100)} />
            </ChartTooltip>
          )}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-ink-faint">
          {[whole[0], whole[whole.length - 1]].map((d) => (
            <span key={d.key}>{shortDay.format(parseYmd(d.key))}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-ink-dim">
        {(
          [
            ["Solar", SOURCES.solar],
            ["Battery", SOURCES.battery],
            ["Grid", SOURCES.grid],
          ] as const
        ).map(([label, c]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i className="size-2 rounded-xs" style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** The last 30 days with readings (today included, still filling in), for the cards above. */
export function useHomeDays(now: number): DataDay[] {
  const today = midnight(now);
  const start = addDays(today, -30);
  const { data } = useQuery(dailyQuery(start, addDays(today, 1)));
  return buildDays(start, addDays(today, 1), today, data, data ? [] : undefined).filter(hasData);
}

const WHOLE_FIELDS = ["load_power", "pv_power", "battery_power"];

/** The whole house through today, every 5 minutes, from the inverter: what Home's cards about it draw from. */
export function useHomeToday(now: number) {
  const today = midnight(now);
  const { data } = useQuery(
    historyQuery({ start: today, end: addDays(today, 1), points: 288, fields: WHOLE_FIELDS, live: true }),
  );
  return { today, series: data?.series };
}
