import type { CSSProperties } from "react";
import { dayMonth, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { fromDateKey } from "~/features/common/time/utils";
import { Card, Footnote, Muted } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import { ChartKey, dim, KeyItem, PickHead, usePick } from "~/features/common/ui/components/Pick";
import type { PerformanceDay, SolarInsights } from "~/features/solar/types";
import { averageRatio, HEALTHY, isLow, nextDate, performanceNote } from "~/features/solar/utils/performance";

type Performance = NonNullable<SolarInsights["performance"]>;

// 70% of what the weather allowed sits at the floor and 110% at the top, so the healthy line sits halfway up.
const FLOOR = 0.7;
const SPAN = 0.4;
const heightOf = (ratio: number) => Math.max(0.04, Math.min(1, (ratio - FLOOR) / SPAN)) * 100;

/** A day as the chart's labels read it: "Today" for the last, else "12 Oct". */
const dayName = (d: PerformanceDay, last: boolean) => (last ? "Today" : dayMonth(fromDateKey(d.date)));

/** The day the rain that washed the panels shows in: the day after it fell, when there's a sign of dust at all. */
export function washedOn(P: Performance | null | undefined): string | null {
  const rain = P?.causes?.dust?.date;
  return rain ? nextDate(rain) : null;
}

/** What a picked day's header says: what it made of what the weather allowed, and what kind of day it was. */
export function dayLine(d: PerformanceDay, washed: string | null): string {
  if (d.ratio == null) return `${shortDay.format(parseYmd(d.date))}: not enough readings to judge`;
  const sky = d.clear ? "clear" : "cloudy, too changeable to judge";
  return `${kWh(d.actual_kwh)} made of ${kWh(d.expected_kwh)} the weather allowed · ${sky}${d.date === washed ? " · rain washed the panels" : ""}`;
}

/**
 * Each of the last 30 days as a bar of its share of what the weather allowed, with a dashed line at the healthy
 * share. Clear days are solar's colour (they're the ones judged); cloudy days stay grey, since modelled sunlight is
 * too rough on them to say much. The day the rain washed the panels gets a dot underneath.
 */
export function RatioBars({
  days,
  washed,
  picked,
  plot,
  item,
}: {
  days: PerformanceDay[];
  washed: string | null;
} & ReturnType<typeof usePick<number>>) {
  const last = days.length - 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative flex h-40 items-end gap-1 max-sm:h-32 max-sm:gap-0.5" {...plot}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed"
          style={{ bottom: `${heightOf(HEALTHY)}%`, borderColor: COLOR.good }}
        >
          <span className="absolute bottom-1 left-0 text-[11px] text-good">{pct(HEALTHY * 100)} healthy</span>
        </div>
        {days.map((d, i) => (
          <button
            key={d.date}
            type="button"
            {...item(i)}
            aria-label={
              d.ratio == null
                ? `${dayName(d, i === last)}: not enough readings`
                : `${dayName(d, i === last)}: ${pct(d.ratio * 100)} of what the weather allowed, ${kWh(d.actual_kwh)} of ${kWh(d.expected_kwh)}${d.clear ? ", clear" : ", cloudy"}${d.date === washed ? ", rain washed the panels" : ""}`
            }
            className={cn(
              "relative flex h-full min-w-0 flex-1 cursor-pointer items-end border-0 bg-transparent p-0",
              dim(picked, i),
            )}
          >
            <i
              className={cn(
                "bar-grow block w-full rounded-[4px_4px_2px_2px]",
                d.ratio == null ? "bg-track" : d.clear ? "bg-solar" : "bg-bar-muted",
                isLow(d) && "opacity-70",
              )}
              style={{ height: `${d.ratio == null ? 4 : heightOf(d.ratio).toFixed(1)}%`, "--i": i } as CSSProperties}
            />
            {d.date === washed && (
              <span
                aria-hidden
                className="absolute -bottom-3 left-1/2 size-1.5 -translate-x-1/2 rounded-full"
                style={{ background: COLOR.link }}
              />
            )}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint tabular-nums">
        <span>{dayName(days[0], false)}</span>
        <span>{dayName(days[Math.floor(last / 2)], false)}</span>
        <span>{dayName(days[last], true)}</span>
      </div>
    </div>
  );
}

/** The key under the 30 days' bars. */
export function RatioKey({ washed }: { washed: boolean }) {
  return (
    <ChartKey>
      <KeyItem swatch={<i className="size-2.5 rounded-[3px] bg-solar" />}>Clear day</KeyItem>
      <KeyItem swatch={<i className="size-2.5 rounded-[3px] bg-bar-muted" />}>Cloudy, not judged</KeyItem>
      {washed && (
        <KeyItem swatch={<i className="size-1.5 rounded-full" style={{ background: COLOR.link }} />}>
          Rain washed the panels
        </KeyItem>
      )}
    </ChartKey>
  );
}

/**
 * Last 30 days: each day's share of what the weather allowed. Pointing at a day reads it out in the header; the corner
 * shows the 30-day average otherwise.
 */
export function PerformanceDays({
  performance: P,
  located,
}: {
  performance: SolarInsights["performance"];
  located: boolean | undefined;
}) {
  const pick = usePick();
  const days = P?.days ?? [];
  const avg = averageRatio(days);
  const washed = washedOn(P);
  const shown = washed && days.some((d) => d.date === washed) ? washed : null;
  const d = pick.picked != null ? days[pick.picked] : null;
  const ready = avg != null && P != null && P.fitted_hours >= 24;
  const shownRatio = d ? d.ratio : avg;
  return (
    <Card aria-labelledby="h-p30">
      <PickHead
        id="h-p30"
        title="Last 30 days"
        sub={
          d
            ? dayLine(d, shown)
            : `Each day's share of what the weather allowed. ${pct(HEALTHY * 100)} or more is healthy.`
        }
        label={d ? dayName(d, pick.picked === days.length - 1) : "30-day average"}
        value={ready ? pct(shownRatio == null ? null : shownRatio * 100) : undefined}
        chip={
          d?.ratio != null && avg != null ? (
            <Delta value={d.ratio - avg}>{signedPct(d.ratio - avg)} on the month</Delta>
          ) : undefined
        }
      />
      {ready ? (
        <>
          <RatioBars days={days} washed={shown} {...pick} />
          <RatioKey washed={shown != null} />
          <Footnote>
            {`What the weather allowed is learned from ${P.fitted_hours.toLocaleString("en-AU")} daylight hours of your readings against past sunlight, at your inverter's limit, so 100% is how your system usually does.`}
          </Footnote>
        </>
      ) : (
        <Muted>{performanceNote(P, located).note}</Muted>
      )}
    </Card>
  );
}
