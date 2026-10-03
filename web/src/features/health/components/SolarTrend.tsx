import type { CSSProperties } from "react";
import type { Insights } from "~/features/health/types";
import { Card, Eyebrow, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { monthShort, monthYear, parseYmd } from "~/features/common/formatting/utils/date";
import { DASH, pct, plural } from "~/features/common/formatting/utils/number";
import { Figure } from "~/features/health/components/Kpis";

const WEAR = -0.008; // a fall faster than this a year is more than panels' usual wear (about 0.5%)

function trendNote(t: NonNullable<Insights["trend"]>): string {
  const n = t.months.length;
  if (!n) return "Fills in as readings and weather build up: a month needs a few bright hours to count.";
  if (t.per_year == null)
    return `A trend shows once there are six months to compare (${n} so far). Seasons move this a few per cent.`;
  if (t.per_year <= WEAR)
    return "That's faster than panels usually wear (about half a per cent a year). Dirt building up, a failing panel or new shade are worth checking.";
  if (t.per_year < 0) return "That's in line with panels' usual slow wear.";
  return "No sign of wear: holding steady.";
}

/**
 * The performance ratio month by month: what the panels made per unit of sunshine on them, as a share of
 * the array's size. A steady fall over a year is wear or dirt; seasons move it a little.
 */
export function SolarTrend({ trend: t }: { trend: Insights["trend"] }) {
  const months = t?.months ?? [];
  const top = Math.max(0.5, ...months.map((m) => m.ratio)) * 1.1;
  const last = months.length - 1;
  return (
    <Card aria-labelledby="h-st">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TitleBlock
          id="h-st"
          title="Solar over the year"
          sub="What the panels make per unit of sunshine on them, month by month"
        />
        <div className="flex flex-col items-end gap-0.5">
          <Eyebrow>Change a year</Eyebrow>
          <Figure small>
            {t?.per_year == null
              ? DASH
              : `${t.per_year > 0 ? "+" : t.per_year < 0 ? "−" : ""}${pct(Math.abs(t.per_year) * 100)}`}
          </Figure>
        </div>
      </div>
      {!t ? (
        <Muted>Needs the stored weather, which fills in once the forecast is on.</Muted>
      ) : (
        <>
          {months.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex h-[150px] items-end gap-2 max-sm:gap-[3px] compact:h-[110px]">
                {months.map((m, k) => (
                  <div
                    key={m.month}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                    title={`${monthYear.format(parseYmd(m.month))}: ${pct(m.ratio * 100)} of the array's size per unit of sunshine, from ${m.hours} bright ${plural(m.hours, "hour")}`}
                  >
                    <span className="font-mono text-[10px] text-ink-faint tabular-nums">{pct(m.ratio * 100)}</span>
                    <i
                      className={cn(
                        "bar-grow block w-full max-w-9 rounded-md",
                        k === last ? "bg-solar" : "bg-bar-muted",
                      )}
                      style={{ height: `${((m.ratio / top) * 100).toFixed(1)}%`, "--i": k } as CSSProperties}
                    />
                  </div>
                ))}
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
