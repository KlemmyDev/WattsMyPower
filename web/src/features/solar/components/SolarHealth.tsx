import type { CSSProperties } from "react";
import { dayMonth, monthShort, monthYear, parseYmd } from "~/features/common/formatting/utils/date";
import { DASH, pct, plural, signedPct } from "~/features/common/formatting/utils/number";
import { useLocationSet } from "~/features/common/settings/hooks";
import { fromDateKey } from "~/features/common/time/utils";
import { Card, Footnote, Muted } from "~/features/common/ui/components/Card";
import { Delta } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import { causesOf } from "~/features/solar/components/PerformanceCauses";
import { dayLine, RatioBars, RatioKey, washedOn } from "~/features/solar/components/PerformanceDays";
import { dim, PickHead, usePick } from "~/features/common/ui/components/Pick";
import type { SolarInsights } from "~/features/solar/types";
import { averageRatio, performanceNote, type Tone } from "~/features/solar/utils/performance";

const noteBg: Record<Tone, string> = { warn: "bg-warn-subtle", ok: "bg-fg/4", wait: "bg-fg/4" };
const noteDot: Record<Tone, string> = { warn: "bg-solar", ok: "bg-good", wait: "bg-grey-500" };

/**
 * The last 30 days against what the weather allowed, with what's likely holding solar back, in one card (the Solar
 * page's widget; the Performance page splits it into cards of their own). Pointing at a day reads it out in the header.
 */
export function SolarPerformance({ performance: P }: { performance: SolarInsights["performance"] }) {
  const days = P?.days ?? [];
  const located = useLocationSet();
  const { tone, note } = performanceNote(P, located);
  const pick = usePick();
  const avg = averageRatio(days);
  const washed = washedOn(P);
  const shown = washed && days.some((d) => d.date === washed) ? washed : null;
  const d = pick.picked != null ? days[pick.picked] : null;
  const ratio = d ? d.ratio : avg;
  const causes = causesOf(P?.causes);
  return (
    <Card aria-labelledby="h-sp">
      <PickHead
        id="h-sp"
        title="Performance"
        sub={d ? dayLine(d, shown) : "What the panels made against what the weather allowed, last 30 days"}
        label={d ? (pick.picked === days.length - 1 ? "Today" : dayMonth(fromDateKey(d.date))) : "30-day average"}
        value={ratio != null ? pct(ratio * 100) : DASH}
        chip={
          d?.ratio != null && avg != null ? (
            <Delta value={d.ratio - avg}>{signedPct(d.ratio - avg)} on the month</Delta>
          ) : undefined
        }
      />
      {avg != null && (
        <>
          <RatioBars days={days} washed={shown} {...pick} />
          <RatioKey washed={shown != null} />
        </>
      )}
      <div className={cn("flex items-start gap-3 rounded-xl px-4 py-3", noteBg[tone])}>
        <i className={cn("mt-[7px] size-2 flex-none rounded-full", noteDot[tone])} />
        <span className="text-[13.5px] leading-[21px] text-pretty">{note}</span>
      </div>
      {causes.length > 0 && (
        <dl className="flex flex-col">
          {causes.map((c) => (
            <div
              key={c.key}
              className="flex flex-col gap-0.5 border-t border-line-subtle py-3 first:border-t-0 first:pt-0"
            >
              <dt className="text-sm font-medium text-ink">{c.title}</dt>
              <dd className="text-[13px] leading-5 text-pretty text-ink-muted">{`${c.seen} ${c.fix}`}</dd>
            </div>
          ))}
        </dl>
      )}
      {P && P.fitted_hours >= 24 && (
        <Footnote>
          {`Expected is learned from ${P.fitted_hours.toLocaleString("en-AU")} daylight hours of your readings against past weather, so 100% is how your system usually does.`}
        </Footnote>
      )}
    </Card>
  );
}

const WEAR = -0.008; // a fall faster than this a year is more than panels' usual wear (about 0.5%)

function trendNote(t: NonNullable<SolarInsights["trend"]>): string {
  const n = t.months.length;
  if (!n) return "Fills in as readings and weather build up. Each month needs a few bright hours to count.";
  if (t.per_year == null)
    return `A trend shows once there are six months to compare (${n} so far). Seasons move this a few per cent.`;
  if (t.per_year <= WEAR)
    return "Faster than panels usually wear (about half a per cent a year). Dirt, a failing panel or new shade are worth checking.";
  if (t.per_year < 0) return "In line with panels' usual slow wear.";
  return "Holding steady, with no sign of wear.";
}

/** A change a year as "+0.4%" or "−1.2%", to a tenth of a per cent (wear is small). */
const perYear = (v: number) => {
  const shown = (Math.abs(v) * 100).toFixed(1);
  return `${v < 0 && shown !== "0.0" ? "−" : v > 0 && shown !== "0.0" ? "+" : ""}${shown}%`;
};

/**
 * What the panels make per unit of sunshine on them, as a share of the array's size, month by month. A steady fall
 * over a year is wear or dirt; seasons move it a little. Pointing at a month reads it out in the header.
 */
export function SolarTrend({ trend: t }: { trend: SolarInsights["trend"] }) {
  const months = t?.months ?? [];
  const top = Math.max(0.5, ...months.map((m) => m.ratio)) * 1.1;
  const last = months.length - 1;
  const { picked: h, plot, item } = usePick();
  const m = h != null ? months[h] : null;
  // Each month against the year's average, so a picked month says whether it was a good one.
  const avg = months.length ? months.reduce((a, x) => a + x.ratio, 0) / months.length : null;
  return (
    <Card aria-labelledby="h-st">
      <PickHead
        id="h-st"
        title="Over the year"
        sub={
          m
            ? `${pct(m.ratio * 100)} of the array's size per unit of sunshine, from ${m.hours.toLocaleString("en-AU")} bright ${plural(m.hours, "hour")}`
            : "What the panels make per unit of sunshine, month by month"
        }
        label={m ? monthYear.format(parseYmd(m.month)) : "Change a year"}
        value={m ? pct(m.ratio * 100) : t?.per_year == null ? DASH : perYear(t.per_year)}
        chip={
          m && avg ? <Delta value={m.ratio / avg - 1}>{signedPct(m.ratio / avg - 1)} on the year</Delta> : undefined
        }
      />
      {!t ? (
        <Muted>Needs past weather, which starts building up once the forecast is on.</Muted>
      ) : (
        <>
          {months.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="relative flex h-[120px] items-end gap-2 max-sm:gap-[3px]" {...plot}>
                {months.map((x, k) => (
                  <button
                    key={x.month}
                    type="button"
                    {...item(k)}
                    aria-label={`${monthYear.format(parseYmd(x.month))}: ${pct(x.ratio * 100)} of the array's size per unit of sunshine, from ${x.hours} bright ${plural(x.hours, "hour")}`}
                    className={cn(
                      "flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1.5 border-0 bg-transparent p-0",
                      dim(h, k),
                    )}
                  >
                    <span className="text-[10px] text-ink-faint tabular-nums max-sm:hidden">{pct(x.ratio * 100)}</span>
                    <i
                      className={cn(
                        "bar-grow block w-full max-w-9 rounded-md",
                        k === last ? "bg-solar" : "bg-bar-muted",
                      )}
                      style={{ height: `${((x.ratio / top) * 100).toFixed(1)}%`, "--i": k } as CSSProperties}
                    />
                  </button>
                ))}
              </div>
              <div className="flex gap-2 max-sm:gap-[3px]">
                {months.map((x) => (
                  <span key={x.month} className="min-w-0 flex-1 text-center text-[11px] text-ink-faint">
                    {monthShort.format(parseYmd(x.month)).slice(0, 3)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Muted>{trendNote(t)}</Muted>
        </>
      )}
    </Card>
  );
}
