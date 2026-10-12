import { Link, useNavigate } from "@tanstack/react-router";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, money, pct } from "~/features/common/formatting/utils/number";
import type { SystemInfo } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { codeIcon, codeName, degrees, hourIconColor } from "~/features/common/weather/utils";
import type { PlanDay } from "~/features/plan/utils";

const TH = "pb-2 text-left text-[11.5px] font-normal text-ink-faint";
const TD = "border-t border-line-subtle py-2.5 text-[13px] tabular-nums";

/** When the battery fills on a day, or how high it gets, in a few words. */
function batteryShort({ battery: b }: PlanDay, now: number): string {
  if (b.now) return "Full now";
  if (b.fullAt) return `${b.fullAt <= now ? "Filled" : "Full"} ${hhmm(b.fullAt)}`;
  return `Tops ${pct(b.max)}`;
}

/**
 * Today and the next two days, a row each: the sky, the solar expected, home use, the battery, the grid and the cost.
 * Choosing a row opens that day in the card above (`onSelect`), or, without it (as a widget), on the Plan page.
 */
export function DaysAhead({
  days,
  selected,
  onSelect,
  system,
  now,
  className,
}: {
  days: PlanDay[];
  selected?: number;
  onSelect?: (i: number) => void;
  system: SystemInfo | undefined;
  now: number;
  className?: string;
}) {
  const fahrenheit = useFahrenheit();
  const navigate = useNavigate();
  const costs = days.some((d) => d.cost != null);
  const open = (i: number) => (onSelect ? onSelect(i) : navigate({ to: "/plan", search: { day: i } }));
  return (
    <Card className={cn("gap-4", className)}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          title="Days ahead"
          sub={
            <>
              Forecast for <b className="font-medium text-ink">{locationLabel(system)}</b>
            </>
          }
        />
        <ButtonLink to="/integrations/weather" variant="link" size="sm">
          Change
        </ButtonLink>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>Day</th>
            <th className={TH}>Sky</th>
            <th className={cn(TH, "text-right")}>Solar</th>
            <th className={cn(TH, "text-right max-sm:hidden")}>Home use</th>
            <th className={cn(TH, "text-right")}>Battery</th>
            <th className={cn(TH, "text-right max-md:hidden")}>Grid</th>
            {costs && <th className={cn(TH, "text-right max-sm:hidden")}>Cost</th>}
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => {
            const on = i === selected;
            const icon = d.day.code != null ? codeIcon(d.day.code, true) : null;
            const filled = d.battery.now || d.battery.fullAt != null;
            const label = `${d.label}, ${shortDay.format(new Date(d.start * 1000))}`;
            return (
              <tr
                key={d.key}
                onClick={() => open(i)}
                className={cn(
                  "cursor-pointer transition-colors duration-200 hover:bg-fg/4",
                  on && "bg-fg/5 hover:bg-fg/5",
                )}
              >
                <td className={cn(TD, "relative pl-3 whitespace-nowrap")}>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-2 left-0 w-[3px] rounded-full transition-opacity duration-200",
                      on ? "opacity-100" : "opacity-0",
                    )}
                    style={{ background: COLOR.export }}
                  />
                  {onSelect ? (
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Show ${label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(i);
                      }}
                      className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-ink"
                    >
                      {d.label}
                    </button>
                  ) : (
                    <Link
                      to="/plan"
                      search={{ day: i }}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-ink no-underline"
                    >
                      {d.label}
                    </Link>
                  )}
                  <span className="block text-[11.5px] text-ink-faint">
                    {shortDay.format(new Date(d.start * 1000))}
                  </span>
                </td>
                <td className={cn(TD, "text-ink-muted")}>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {icon && (
                      <span
                        className="flex flex-none"
                        style={{ color: hourIconColor(icon) }}
                        title={d.day.code != null ? codeName(d.day.code) : undefined}
                      >
                        <Icon name={icon} size={16} />
                      </span>
                    )}
                    {d.day.temp_max != null && degrees(d.day.temp_max, fahrenheit)}
                    {d.day.precip >= 40 && <span className="text-ink-faint max-lg:hidden">{d.day.precip}% rain</span>}
                  </span>
                </td>
                <td className={cn(TD, "text-right font-medium whitespace-nowrap")}>
                  {kWh(d.pv)}
                  {d.pvRange && (
                    <span className="block text-[11.5px] font-normal text-ink-faint">
                      {Math.round(d.pvRange[0])}–{Math.round(d.pvRange[1])}
                    </span>
                  )}
                </td>
                <td className={cn(TD, "text-right whitespace-nowrap max-sm:hidden")}>{kWh(d.load)}</td>
                <td
                  className={cn(TD, "text-right whitespace-nowrap")}
                  style={{ color: filled ? COLOR.battery : undefined }}
                >
                  {batteryShort(d, now)}
                </td>
                <td className={cn(TD, "text-right whitespace-nowrap max-md:hidden")}>
                  {d.imp < 0.05 ? <span className="text-ink-faint">None</span> : kWh(d.imp)}
                </td>
                {costs && (
                  <td
                    className={cn(TD, "pr-1 text-right whitespace-nowrap max-sm:hidden")}
                    style={{ color: d.cost != null && d.cost < 0 ? COLOR.good : undefined }}
                  >
                    {money(d.cost)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
