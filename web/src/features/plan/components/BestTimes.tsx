import { priceLabel } from "~/features/amber/utils";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import type { bestTimes, Window } from "~/features/plan/utils";

const span = (w: Window) => `${hhmm(w.start)} to ${hhmm(w.end)}`;
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
      title: `${span(w)}: use spare solar`,
      sub:
        `About ${kWh(w.kwh)} of solar would go to the grid${w.rate == null ? "" : ` for ${priceLabel(w.rate)}/kWh`}. ` +
        "Run the dishwasher, washing machine, dryer or pool pump then.",
    })),
    ...paid.map((w) => ({
      w,
      icon: "dollar" as const,
      color: COLOR.good,
      title: `${span(w)}: paid to use power`,
      sub: `Amber's price is below zero${w.rate == null ? "" : ` (${priceLabel(w.rate)}/kWh)`}, so this is the time for big loads.`,
    })),
    ...avoid.map((w) => ({
      w,
      icon: "grid" as const,
      color: COLOR.bad,
      title: `${span(w)}: go easy on the grid`,
      sub:
        `About ${kWh(w.kwh)} from the grid${at(w)}. ` +
        (spare.length ? "Move what you can to the spare solar hours." : "Run big loads earlier if you can."),
    })),
  ].sort((a, b) => a.w.start - b.w.start);

  if (!items.length)
    return (
      <div className="text-sm text-ink-muted">
        {today ? "For the rest of today" : "On this day"}, no spare solar or costly grid hours are forecast. Use power
        whenever suits.
      </div>
    );
  return (
    <ol className="flex flex-col">
      {items.map(({ w, icon, color, title, sub }) => (
        <li
          key={`${w.kind}${w.start}`}
          className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3 border-t border-line-subtle py-3 first:border-t-0 first:pt-0"
        >
          <span className="mt-0.5 flex size-7 items-center justify-center rounded-full" style={{ background: color }}>
            <span className="text-ink-inverse">
              <Icon name={icon} size={15} />
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium text-ink tabular-nums">{title}</span>
            <span className="text-[13px] leading-[19px] text-pretty text-ink-dim">{sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
