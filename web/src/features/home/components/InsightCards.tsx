import { dollars, kW, kWh } from "~/features/common/formatting/utils/number";
import { hhmm } from "~/features/common/formatting/utils/date";
import { midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { Swatch } from "~/features/common/ui/components/Swatch";
import type { HomeDevice, HomeInsights } from "~/features/home/types";
import { OTHER_COLOR } from "~/features/home/utils";

const watts = (w: number) => (w >= 1000 ? kW(w) : `${w < 10 ? w.toFixed(1).replace(/\.0$/, "") : Math.round(w)} W`);

/**
 * What the home draws all the time: the least it drew overnight on a typical night, what that comes to a year, and
 * which devices account for some of it. The rest is what no device measures (a router, a TV on standby, the fridge).
 */
export function StandbyCard({
  standby,
  devices,
  colors,
}: {
  standby: HomeInsights["standby"] | undefined;
  devices: HomeDevice[];
  colors: Map<number, string>;
}) {
  const names = new Map(devices.map((d) => [d.id, d.name]));
  const listed = (standby?.devices ?? []).filter((d) => names.has(d.id));
  const rest = standby?.home_w != null ? Math.max(0, standby.home_w - standby.measured_w) : null;
  return (
    <Card aria-labelledby="h-standby" className="col-span-6 gap-4 max-lg:col-span-12">
      <div className="flex flex-col gap-0.5">
        <h2 id="h-standby">Always on</h2>
        <span className="text-[13px] text-pretty text-ink-muted">
          The least your home draws overnight, on a typical night: what runs all day, every day
        </span>
      </div>
      {!standby ? (
        <Skeleton className="h-[120px]" />
      ) : standby.home_w == null ? (
        <span className="text-sm text-ink-muted">This shows after a few nights of readings.</span>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">
              {watts(standby.home_w)}
            </span>
            <span className="pb-1.5 text-sm text-ink-muted tabular-nums">
              about <b className="font-semibold text-ink">{dollars(standby.yearly_cost)}</b> a year, from{" "}
              {standby.nights} nights
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm tabular-nums">
            {listed.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <Swatch color={colors.get(d.id) ?? OTHER_COLOR} size={10} />
                <span className="min-w-0 flex-1 truncate text-ink-muted">{names.get(d.id)}</span>
                <span className="font-medium">{watts(d.w)}</span>
                <span className="w-16 text-right text-ink-faint">{dollars(d.yearly_cost)}/yr</span>
              </li>
            ))}
            {rest != null && rest > 0 && (
              <li className="flex items-center gap-2">
                <Swatch color={OTHER_COLOR} size={10} />
                <span className="min-w-0 flex-1 truncate text-ink-muted">Not measured by a device</span>
                <span className="font-medium">{watts(rest)}</span>
                <span className="w-16 text-right text-ink-faint">
                  {dollars((rest / 1000) * 24 * 365 * standby.rate)}/yr
                </span>
              </li>
            )}
          </ul>
          {rest != null && rest >= 50 && (
            <span className="text-[13px] text-pretty text-ink-muted">
              A smart plug on what's left on overnight (the router, the TV and its box, a second fridge) shows where the
              rest goes.
            </span>
          )}
        </>
      )}
    </Card>
  );
}

/** "6:10 am"-style time of day, from minutes into it. */
const atTime = (minutes: number) => hhmm(midnight(Date.now() / 1000) + minutes * 60);

/**
 * Habits in what no device measures: blocks of use that come back at about the same time on several days, with what
 * they might be, and a nudge to measure them.
 */
export function HabitsCard({ unexplained }: { unexplained: HomeInsights["unexplained"] | undefined }) {
  return (
    <Card aria-labelledby="h-habits" className="col-span-6 gap-4 max-lg:col-span-12">
      <div className="flex flex-col gap-0.5">
        <h2 id="h-habits">In everything else</h2>
        <span className="text-[13px] text-pretty text-ink-muted">
          Big use no device measures that comes back at about the same time, over the last {unexplained?.days || 14}{" "}
          days
        </span>
      </div>
      {!unexplained ? (
        <Skeleton className="h-[120px]" />
      ) : unexplained.days < 3 ? (
        <span className="text-sm text-ink-muted">This shows after a few days of readings.</span>
      ) : !unexplained.habits.length ? (
        <span className="text-sm text-ink-muted">
          Nothing regular stands out: no big block comes back day after day.
        </span>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {unexplained.habits.map((h) => (
              <li
                key={`${h.at}-${h.kw}`}
                className="flex flex-col gap-0.5 border-t border-line-subtle py-2.5 first:border-t-0 first:pt-0"
              >
                <span className="text-sm">
                  <b className="font-medium">Around {atTime(h.at)}</b>, about {kW(h.kw * 1000)} for {h.minutes} min
                </span>
                <span className="text-[13px] text-ink-muted tabular-nums">
                  {h.days} of {h.of_days} days · {kWh(h.kwh_per_day)} a day on average
                  {h.guess_label && (
                    <>
                      {" · "}
                      might be <b className="font-medium text-ink">{h.guess_label}</b>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <span className="text-[13px] text-pretty text-ink-muted">
            A smart plug or an energy monitor on it would give it its own line here, with what it costs.
          </span>
        </>
      )}
    </Card>
  );
}
