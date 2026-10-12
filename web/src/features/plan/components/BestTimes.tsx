import { priceLabel } from "~/features/amber/utils";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { MomentList } from "~/features/plan/components/Moments";
import { useDayPlan, type Plan } from "~/features/plan/hooks";
import type { bestTimes, PlanDay, Window } from "~/features/plan/utils";

const span = (w: Window) => `${hhmm(w.start)}–${hhmm(w.end)}`;
const at = (w: Window) => (w.rate == null ? "" : ` at ${w.band ? `${w.band} ` : ""}${priceLabel(w.rate)}/kWh`);

type Item = { w: Window; icon: IconName; color: string; title: string; sub: string };

/** The day's best times to use power, and the hours to go easy on the grid, in time order. */
export function BestTimes({ times, today }: { times: ReturnType<typeof bestTimes>; today: boolean }) {
  const { spare, avoid, paid } = times;
  const items: Item[] = [
    ...spare.map((w) => ({
      w,
      icon: "sun" as const,
      color: COLOR.export,
      title: "Use spare solar",
      sub:
        `About ${kWh(w.kwh)} of solar would go to the grid${w.rate == null ? "" : ` for ${priceLabel(w.rate)}/kWh`}. ` +
        "Good for the dishwasher, washer, dryer or pool pump.",
    })),
    ...paid.map((w) => ({
      w,
      icon: "dollar" as const,
      color: COLOR.good,
      title: "Paid to use power",
      sub: `Amber's price drops below zero${w.rate == null ? "" : ` (${priceLabel(w.rate)}/kWh)`}, so you're paid to run big loads.`,
    })),
    ...avoid.map((w) => ({
      w,
      icon: "grid" as const,
      color: COLOR.bad,
      title: "Go easy on the grid",
      sub:
        `About ${kWh(w.kwh)} from the grid${at(w)}. ` +
        (spare.length ? "Move what you can to the spare solar hours." : "Run big loads earlier if you can."),
    })),
  ].sort((a, b) => a.w.start - b.w.start);

  if (!items.length)
    return (
      <div className="text-sm text-ink-muted">
        {today ? "For the rest of today" : "On this day"}, no spare solar or costly grid hours are forecast. Use power
        whenever suits you.
      </div>
    );
  return (
    <ol className="flex flex-col">
      {items.map(({ w, icon, color, title, sub }) => (
        <li
          key={`${w.kind}${w.start}`}
          className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line-subtle py-3 first:border-t-0 first:pt-0"
        >
          <span className="mt-0.5 flex size-7 items-center justify-center rounded-full" style={{ background: color }}>
            <span className="text-ink-inverse">
              <Icon name={icon} size={15} />
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium text-ink">{title}</span>
            <span className="text-[13px] leading-[19px] text-pretty text-ink-dim">{sub}</span>
          </span>
          <span className="text-sm leading-5 font-medium whitespace-nowrap text-ink tabular-nums">{span(w)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * When to use power on a day, as a card: its best times and the hours to go easy on the grid, then its key moments,
 * numbered as the chart above marks them.
 */
export function BestTimesCard({
  plan,
  day,
  now,
  className,
}: {
  plan: Plan;
  day: PlanDay;
  now: number;
  className?: string;
}) {
  const { times, events } = useDayPlan(plan, day, now);
  if (!times) return null;
  return (
    <Card className={className}>
      <TitleBlock
        title="Best times to use power"
        sub={day.today ? "The rest of today, from the forecast" : `${day.label}, from the forecast`}
      />
      <BestTimes times={times} today={day.today} />
      {events.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
          <h3 className="text-[13px] font-normal text-ink-muted">Key moments, as marked on the chart</h3>
          <MomentList moments={events} />
        </div>
      )}
    </Card>
  );
}
