import type { BillDay, Bills } from "~/features/bills/types";
import { billCents } from "~/features/bills/utils";
import { dayMonth, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, fromDateKey, partsOf } from "~/features/common/time/utils";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";

const BOUGHT = COLOR.import;
const SUPPLY = COLOR.bar;
const FEED_IN = COLOR.export;
const AHEAD = alpha(COLOR.fg, 0.35);
const AHEAD_FILL = alpha(COLOR.fg, 0.05);

type Col = { key: string; date: number; day?: BillDay; expected?: number };

/** A day's bar: up, the supply charge with what was bought on it; down, the feed-in credit (as costs and credits). */
function split(d: BillDay) {
  // On Amber a negative feed-in price makes sending power out cost money: it goes on top instead.
  const feedCost = Math.max(0, -d.feed_in_credit);
  return { supply: d.supply, bought: d.import_cost + feedCost, credit: Math.max(0, d.feed_in_credit) };
}

/**
 * Every day of the billing period as a bar of what it cost: the supply charge and what was bought stacked above the
 * line, the feed-in credit below it, and the days still to come as a dashed outline of what each is expected to cost.
 * Hover or tap a day for what made it up.
 */
export function BillDays({ bills }: { bills: Bills }) {
  const { hover: h, width, plot, bar } = useBarHover();
  const byDate = new Map(bills.days.map((d) => [d.date, d]));
  const ahead = new Map(bills.ahead.map((a) => [a.date, a.net_cost]));
  const start = fromDateKey(bills.period.start);
  const cols: Col[] = Array.from({ length: bills.period.days }, (_, i) => {
    const date = addDays(start, i);
    const key = dateKey(date);
    return { key, date, day: byDate.get(key), expected: ahead.get(key) };
  });
  const ups = cols.map((c) => (c.day ? split(c.day).supply + split(c.day).bought : Math.max(0, c.expected ?? 0)));
  const downs = cols.map((c) => (c.day ? split(c.day).credit : Math.max(0, -(c.expected ?? 0))));
  const hi = Math.max(0.01, ...ups);
  const lo = Math.max(0, ...downs);
  // One scale above and below the line, which sits as far up as the biggest credit needs.
  const zero = lo / (hi + lo);
  const y = (v: number) => (v / (hi + lo)) * 100;
  const hovered = h != null ? cols[h] : null;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative grid h-[180px] gap-0.5 max-sm:h-[140px] max-sm:gap-px"
        style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label="What each day of this bill cost"
        {...plot}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-line-subtle"
          style={{ bottom: `${zero * 100}%` }}
        />
        {cols.map((c, i) => {
          const s = c.day ? split(c.day) : null;
          return (
            <button
              key={c.key}
              type="button"
              {...bar(i)}
              aria-label={label(c)}
              className={cn(
                "relative h-full border-0 bg-transparent p-0 transition-opacity duration-200",
                h != null && h !== i && "opacity-50",
              )}
            >
              {s ? (
                <>
                  <i
                    className="absolute inset-x-0 rounded-t-[2px]"
                    style={{
                      bottom: `${zero * 100}%`,
                      height: `${y(s.supply + s.bought)}%`,
                      background: `linear-gradient(to top, ${SUPPLY} ${pctOf(s.supply, s.supply + s.bought)}, ${BOUGHT} 0)`,
                      opacity: c.day!.partial ? 0.6 : 1,
                    }}
                  />
                  {s.credit > 0 && (
                    <i
                      className="absolute inset-x-0 rounded-b-[2px]"
                      style={{
                        top: `${(1 - zero) * 100}%`,
                        height: `${y(s.credit)}%`,
                        background: FEED_IN,
                        opacity: c.day!.partial ? 0.6 : 1,
                      }}
                    />
                  )}
                </>
              ) : c.expected != null ? (
                <i
                  className="absolute inset-x-0 rounded-[2px]"
                  style={{
                    ...(c.expected >= 0
                      ? { bottom: `${zero * 100}%`, height: `${y(c.expected)}%` }
                      : { top: `${(1 - zero) * 100}%`, height: `${y(-c.expected)}%` }),
                    background: AHEAD_FILL,
                    [c.expected >= 0 ? "borderTop" : "borderBottom"]: `1.5px dashed ${AHEAD}`,
                  }}
                />
              ) : null}
            </button>
          );
        })}
        {hovered && h != null && (
          <ChartTooltip left={((h + 0.5) / cols.length) * 100} flip={h > cols.length / 2} width={width}>
            <span className="font-medium text-ink">
              {shortDay.format(hovered.date * 1000)}
              {hovered.day?.partial ? " so far" : ""}
            </span>
            {hovered.day ? (
              <>
                <TooltipRow label="Bought" value={money(hovered.day.import_cost)} color={BOUGHT} />
                <TooltipRow label="Supply" value={money(hovered.day.supply)} color={SUPPLY} />
                <TooltipRow
                  label="Feed-in"
                  value={money(hovered.day.feed_in_credit ? -hovered.day.feed_in_credit : 0)}
                  color={FEED_IN}
                />
                <TooltipRow label="Day's cost" value={billCents(hovered.day.net_cost)} />
                <span className="text-xs text-ink-faint">
                  {kWh(hovered.day.import_kwh)} in · {kWh(hovered.day.export_kwh)} out
                </span>
              </>
            ) : hovered.expected != null ? (
              <TooltipRow label="Expected" value={`about ${billCents(hovered.expected)}`} color={AHEAD} />
            ) : (
              <span className="text-ink-muted">No readings</span>
            )}
          </ChartTooltip>
        )}
      </div>
      <div className="relative h-4 font-mono text-[11px] text-ink-faint tabular-nums" aria-hidden>
        {cols.map((c, i) =>
          i === 0 || partsOf(c.date).day === 1 || i === cols.length - 1 ? (
            <span
              key={c.key}
              className={cn(
                "absolute whitespace-nowrap",
                i === cols.length - 1 ? "-translate-x-full" : i > 0 && "-translate-x-1/2",
                // Too close to the last day's label: leave it to that one.
                i > 0 && i < cols.length - 1 && i > cols.length - 6 && "hidden",
              )}
              style={{ left: `${((i + (i === cols.length - 1 ? 1 : 0)) / cols.length) * 100}%` }}
            >
              {dayMonth(c.date)}
            </span>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        <Key color={BOUGHT}>Bought</Key>
        <Key color={SUPPLY}>Supply</Key>
        <Key color={FEED_IN}>Feed-in credit</Key>
        <span className="flex items-center gap-1.5">
          <i
            className="size-2 rounded-[2px] border-t-[1.5px] border-dashed"
            style={{ borderColor: AHEAD, background: AHEAD_FILL }}
          />
          Expected
        </span>
      </div>
    </div>
  );
}

const pctOf = (part: number, whole: number) => `${whole > 0 ? (part / whole) * 100 : 100}%`;

function label(c: Col) {
  const day = dayMonth(c.date);
  if (c.day) return `${day}${c.day.partial ? " so far" : ""}: ${billCents(c.day.net_cost)}`;
  if (c.expected != null) return `${day}: expected about ${billCents(c.expected)}`;
  return `${day}: no readings`;
}

function Key({ color, children }: { color: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="size-2 rounded-[2px]" style={{ background: color }} />
      {children}
    </span>
  );
}
