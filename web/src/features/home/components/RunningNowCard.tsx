import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { homeQuery } from "~/features/home/api";
import { deviceColors, kindIcon } from "~/features/home/utils";

/**
 * On the Overview, while an appliance is running: each one with where its cycle is, how long is left (and when that
 * is), what it's drawing and what the run has used so far. Nothing at all while nothing is running.
 */
export function RunningNowCard() {
  const { data } = useQuery(homeQuery);
  const devices = data?.devices ?? [];
  const running = devices.filter((d) => !d.hidden && d.now?.running && !d.now.stale && d.now.online);
  if (!running.length) return null;
  const colors = deviceColors(devices);
  return (
    <Card aria-labelledby="h-running" className="col-span-12 gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="h-running">Running now</h2>
        <Link to="/home" className="text-[13px] text-brand no-underline hover:underline">
          Home
        </Link>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
        {running.map((d) => {
          const n = d.now!;
          const color = colors.get(d.id) ?? "var(--color-brand)";
          const left = n.remaining_min ? Math.round(n.remaining_min) : null;
          return (
            <li key={d.id} className="flex items-center gap-3 rounded-xl bg-surface-raised px-3.5 py-3">
              <span
                className="flex size-10 flex-none items-center justify-center rounded-full"
                style={{ background: alpha(color, 0.16), color }}
              >
                <Icon name={kindIcon(d.kind)} size={20} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  to="/home/$device"
                  params={{ device: String(d.id) }}
                  className="truncate text-sm font-semibold text-ink no-underline hover:underline"
                >
                  {d.name}
                </Link>
                <span className="truncate text-[13px] text-ink-muted tabular-nums">
                  {[
                    n.phase ?? "Running",
                    left != null ? `${left} min left, done about ${hhmm(n.at + left * 60)}` : null,
                    n.power_w != null && n.power_w >= 2 ? kW(n.power_w) : null,
                    n.run && n.run.kwh > 0 ? `${kWh(n.run.kwh)} so far` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
