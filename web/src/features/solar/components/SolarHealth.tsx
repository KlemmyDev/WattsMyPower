import type { CSSProperties, ReactNode } from "react";
import { dayMonth, listDays, monthShort, monthYear, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { fromDateKey } from "~/features/common/time/utils";
import { DASH, kWh, pct, plural } from "~/features/common/formatting/utils/number";
import { Card, Footnote, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import type { Causes, SolarInsights } from "~/features/solar/types";

type Performance = NonNullable<SolarInsights["performance"]>;
type Day = Performance["days"][number];
type Rated = Day & { ratio: number };
type Tone = "warn" | "ok" | "wait";

/** A figure beside a card's title, with what it is above it. */
function Corner({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{children}</span>
    </div>
  );
}

const dayLabel = (d: Day) => dayMonth(fromDateKey(d.date));

/** A clear day more than 10% under what the weather allowed. */
const isLow = (d: Day) => d.clear && d.ratio != null && d.ratio < 0.9;

function performanceNote(P: SolarInsights["performance"], rated: Rated[]): { tone: Tone; note: string } {
  if (!P)
    return {
      tone: "wait",
      note: "Past weather isn't available right now, so solar can't be compared with what the weather allowed.",
    };
  if (P.fitted_hours < 24 || !rated.length)
    return {
      tone: "wait",
      note: "Learning what your panels should make for the weather. This needs a few days of daylight readings.",
    };
  const lows = rated.filter(isLow).map((d) => d.date);
  if (!lows.length) return { tone: "ok", note: "Within 10% of expected on every clear day with readings." };
  const when =
    lows.length <= 4
      ? `on ${listDays(lows)}, ${lows.length === 1 ? "a clear day" : "all clear days"}`
      : `on ${lows.length} clear days in the last 30, most recently ${listDays(lows.slice(-1))}`;
  return {
    tone: "warn",
    note: `More than 10% below expected ${when}. Dust, bird droppings or new shade are the usual causes: worth a look if it carries on.`,
  };
}

const noteBg: Record<Tone, string> = { warn: "bg-warn-subtle", ok: "bg-fg/4", wait: "bg-fg/4" };
const noteDot: Record<Tone, string> = { warn: "bg-solar", ok: "bg-good", wait: "bg-grey-500" };

/** The last 30 days against what the weather allowed, with what's likely holding solar back. */
export function SolarPerformance({ performance: P }: { performance: SolarInsights["performance"] }) {
  const days = P?.days ?? [];
  const rated = days.filter((d): d is Rated => d.ratio != null);
  const { tone, note } = performanceNote(P, rated);
  const { hover: h, width, plot, bar } = useBarHover();
  return (
    <Card aria-labelledby="h-sp">
      <div className="flex items-end justify-between gap-4">
        <TitleBlock
          className="min-w-0 flex-1"
          id="h-sp"
          title="Performance"
          sub="What the panels made against what the weather allowed, last 30 days"
        />
        <Corner label="30-day average">
          {rated.length ? pct((rated.reduce((a, d) => a + d.ratio, 0) / rated.length) * 100) : DASH}
        </Corner>
      </div>
      {rated.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="relative flex h-32 items-end gap-1 max-sm:gap-0.5" {...plot}>
            <div className="pointer-events-none absolute inset-x-0 top-1/4 border-t border-dashed border-line-strong">
              <span className="absolute right-0 bottom-1 bg-surface pl-1.5 text-[10.5px] text-ink-faint">
                As expected
              </span>
            </div>
            {days.map((d, i) => (
              <DayBar key={d.date} day={d} i={i} hover={h} {...bar(i)} />
            ))}
            {h != null && (
              <ChartTooltip left={((h + 0.5) / days.length) * 100} flip={h > days.length / 2} width={width}>
                <DayTip day={days[h]} />
              </ChartTooltip>
            )}
          </div>
          <div className="flex justify-between font-mono text-[11px] text-ink-faint">
            {[days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].map((d, i) => (
              <span key={i}>{dayLabel(d)}</span>
            ))}
          </div>
        </div>
      )}
      <div className={cn("flex items-start gap-3 rounded-xl px-4 py-3", noteBg[tone])}>
        <i className={cn("mt-[7px] size-2 flex-none rounded-full", noteDot[tone])} />
        <span className="text-[13.5px] leading-[21px] text-pretty">{note}</span>
      </div>
      {P?.causes && <LikelyCauses causes={P.causes} />}
      {P && P.fitted_hours >= 24 && (
        <Footnote>
          {`Expected is learned from ${P.fitted_hours.toLocaleString("en-AU")} daylight hours of your inverter against past weather, so 100% is how your system usually does.`}
        </Footnote>
      )}
    </Card>
  );
}

/** What's likely holding output back, in plain words, with what to do about it. */
function LikelyCauses({ causes: c }: { causes: Causes }) {
  const items: [title: string, body: string][] = [];
  if (c.dust) {
    items.push([
      "Dust on the panels",
      `After ${c.dust.rain_mm} mm of rain on ${dayMonth(fromDateKey(c.dust.date))}, clear days went from ${pct(c.dust.before * 100)} to ${pct(c.dust.after * 100)} of expected. If it's been dry since, a clean may be worth it.`,
    ]);
  }
  if (c.shade)
    items.push([
      `New shade in the ${c.shade.part}`,
      `${c.shade.part === "afternoon" ? "Afternoons" : "Mornings"} are ${pct(c.shade.drop * 100)} down on the rest of the day over the last two weeks. A growing tree or something new nearby can do this; the sun's path moving with the seasons can too, a little.`,
    ]);
  if (c.capped && c.capped.days)
    items.push([
      "The inverter's limit",
      `On ${c.capped.days} ${plural(c.capped.days, "day")}, output was held at about ${c.capped.limit_kw} kW while the sun could have given more: about ${kWh(c.capped.kwh)} in all. Normal with more panels than inverter.`,
    ]);
  if (!items.length) return null;
  return (
    <dl className="flex flex-col">
      {items.map(([title, body]) => (
        <div key={title} className="flex flex-col gap-0.5 border-t border-line-subtle py-3 first:border-t-0 first:pt-0">
          <dt className="text-sm font-medium text-ink">{title}</dt>
          <dd className="text-[13px] leading-5 text-pretty text-ink-muted">{body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A day's column, the full height of the chart so a short bar is as easy to point at as a tall one. */
function DayBar({
  day: d,
  i,
  hover,
  ...on
}: { day: Day; i: number; hover: number | null } & ReturnType<ReturnType<typeof useBarHover>["bar"]>) {
  const label = shortDay.format(parseYmd(d.date));
  // 70% of expected sits at the floor and 110% at the top, so 100% lines up with the dashed line.
  const h = d.ratio == null ? 0 : Math.max(0.04, Math.min(1, (d.ratio - 0.7) / 0.4)) * 100;
  return (
    <button
      type="button"
      {...on}
      aria-label={
        d.ratio == null
          ? `${label}: not enough readings`
          : `${label}: ${pct(d.ratio * 100)} of expected (${kWh(d.actual_kwh)} of ${kWh(d.expected_kwh)})${d.clear ? "" : ", cloudy"}`
      }
      className={cn(
        "flex h-full min-w-0 flex-1 cursor-pointer items-end border-0 bg-transparent p-0 transition-opacity duration-200",
        hover != null && hover !== i && "opacity-45",
      )}
    >
      <i
        className={cn(
          "bar-grow block w-full rounded-[4px_4px_2px_2px] transition-[background-color,filter] duration-200",
          isLow(d) ? "bg-solar" : hover === i ? "bg-ink-faint" : "bg-bar-muted",
        )}
        style={{ height: `${h.toFixed(1)}%`, "--i": i } as CSSProperties}
      />
    </button>
  );
}

function DayTip({ day: d }: { day: Day }) {
  return (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{shortDay.format(parseYmd(d.date))}</span>
        <span className="text-xs text-ink-faint">{d.clear ? "Clear" : "Cloudy"}</span>
      </span>
      {d.ratio == null ? (
        <span className="text-ink-muted">Not enough readings</span>
      ) : (
        <>
          <TooltipRow label="Of expected" value={pct(d.ratio * 100)} />
          <TooltipRow label="Made" value={kWh(d.actual_kwh)} />
          <TooltipRow label="Expected" value={kWh(d.expected_kwh)} />
        </>
      )}
    </>
  );
}

const WEAR = -0.008; // a fall faster than this a year is more than panels' usual wear (about 0.5%)

function trendNote(t: NonNullable<SolarInsights["trend"]>): string {
  const n = t.months.length;
  if (!n) return "Fills in as readings and weather build up: a month needs a few bright hours to count.";
  if (t.per_year == null)
    return `A trend shows once there are six months to compare (${n} so far). Seasons move this a few per cent.`;
  if (t.per_year <= WEAR)
    return "Faster than panels usually wear (about half a per cent a year). Dirt, a failing panel or new shade are worth checking.";
  if (t.per_year < 0) return "In line with panels' usual slow wear.";
  return "No sign of wear: holding steady.";
}

/**
 * What the panels make per unit of sunshine on them, as a share of the array's size, month by month. A steady fall
 * over a year is wear or dirt; seasons move it a little.
 */
export function SolarTrend({ trend: t }: { trend: SolarInsights["trend"] }) {
  const months = t?.months ?? [];
  const top = Math.max(0.5, ...months.map((m) => m.ratio)) * 1.1;
  const last = months.length - 1;
  const { hover: h, width, plot, bar } = useBarHover();
  return (
    <Card aria-labelledby="h-st">
      <div className="flex items-end justify-between gap-4">
        <TitleBlock
          className="min-w-0 flex-1"
          id="h-st"
          title="Over the year"
          sub="What the panels make per unit of sunshine, month by month"
        />
        <Corner label="Change a year">
          {t?.per_year == null
            ? DASH
            : `${t.per_year > 0 ? "+" : t.per_year < 0 ? "−" : ""}${pct(Math.abs(t.per_year) * 100)}`}
        </Corner>
      </div>
      {!t ? (
        <Muted>Needs the stored weather, which fills in once the forecast is on.</Muted>
      ) : (
        <>
          {months.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="relative flex h-[120px] items-end gap-2 max-sm:gap-[3px]" {...plot}>
                {months.map((m, k) => (
                  <button
                    key={m.month}
                    type="button"
                    {...bar(k)}
                    aria-label={`${monthYear.format(parseYmd(m.month))}: ${pct(m.ratio * 100)} of the array's size per unit of sunshine, from ${m.hours} bright ${plural(m.hours, "hour")}`}
                    className={cn(
                      "flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1.5 border-0 bg-transparent p-0 transition-opacity duration-200",
                      h != null && h !== k && "opacity-45",
                    )}
                  >
                    <span className="font-mono text-[10px] text-ink-faint tabular-nums">{pct(m.ratio * 100)}</span>
                    <i
                      className={cn(
                        "bar-grow block w-full max-w-9 rounded-md transition-[background-color] duration-200",
                        k === last ? "bg-solar" : h === k ? "bg-ink-faint" : "bg-bar-muted",
                      )}
                      style={{ height: `${((m.ratio / top) * 100).toFixed(1)}%`, "--i": k } as CSSProperties}
                    />
                  </button>
                ))}
                {h != null && (
                  <ChartTooltip left={((h + 0.5) / months.length) * 100} flip={h > months.length / 2} width={width}>
                    <span className="font-medium text-ink">{monthYear.format(parseYmd(months[h].month))}</span>
                    <TooltipRow label="Per unit of sun" value={pct(months[h].ratio * 100)} />
                    <TooltipRow label="Bright hours" value={months[h].hours.toLocaleString("en-AU")} />
                  </ChartTooltip>
                )}
              </div>
              <div className="flex gap-2 max-sm:gap-[3px]">
                {months.map((m) => (
                  <span key={m.month} className="min-w-0 flex-1 text-center font-mono text-[11px] text-ink-faint">
                    {monthShort.format(parseYmd(m.month))}
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
