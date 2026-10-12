import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { kW, kWh, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";
import type { EvBrief } from "~/features/ev/types";
import { carTitle, MODE_LABEL, STATUS_LABEL, statusColor } from "~/features/ev/utils";
import { homeUsageQuery } from "~/features/home/api";

/** The car's own colour, as Home draws it. */
const CAR = COLOR.lilac;

/** What the card shows, given room for it. */
export type EvShow = {
  /** What it charged at home today, and how much of that was sunshine. */
  today: boolean;
  /** What it's doing, in a sentence. */
  doing: boolean;
};

export const evShow = (settings: Settings): EvShow => ({
  today: settings.today !== false,
  doing: settings.doing !== false,
});
const ALL = evShow({});

const HEAD = 28 + 12;
const FIGURE = 56 + 12;
const BAR = 10 + 8 + 16 + 12;
const FACTS = 1 + 12 + 40;
const DOING = 20 + 12;

/** The most rows the card can use for what it shows. */
export const evRows = (show: EvShow, w: number) =>
  rowsFor(HEAD + FIGURE + BAR + (show.today && w >= 3 ? FACTS : 0) + (show.doing ? DOING : 0));

/**
 * Any connected car (a Tesla, a BYD, a Hyundai or Kia), for a dashboard, fitted to its size: its charge, a bar of it with
 * a tick for where it charges to, what it's doing and drawing, what it charged at home today (and how much of that was
 * sunshine) and how it's set to charge. At its smallest (2 × 2) it's the charge and the bar. The card takes a glow
 * from its corner, brighter while it charges.
 */
export function EvNow({
  car,
  cars,
  now,
  w = 4,
  h = 4,
  show = ALL,
}: {
  car: EvBrief | undefined;
  /** How many cars are connected: what's charged at home today is all of theirs together. */
  cars: number;
  now: number;
  w?: number;
  h?: number;
  show?: EvShow;
}) {
  const { wide, tall } = roomOf(w, h);
  const start = midnight(now);
  const { data: usage } = useQuery({
    ...homeUsageQuery(start, addDays(start, 1), "hour"),
    enabled: show.today && tall !== "short",
  });
  if (!car)
    return (
      <Card className="h-full gap-3 p-5 max-sm:p-4">
        <span className="text-[13px] text-ink-muted">Car</span>
        <span className="text-[13px] text-ink-faint">Looking for your car…</span>
      </Card>
    );
  const charging = car.status === "charging";
  const status = statusColor(car.status, car.mode);
  const short = tall === "short";
  const narrow = wide === "xs";
  const soc = car.soc;
  const today = usage?.car;
  return (
    <Card
      aria-label={`${car.name ?? carTitle(car)}, ${soc != null ? `${Math.round(soc)}%` : "charge not read"}`}
      className="h-full gap-3 overflow-hidden p-5 max-sm:p-4"
      style={{
        backgroundImage: `radial-gradient(circle at 0% 100%, ${alpha(charging ? status : CAR, charging ? 0.22 : 0.14)}, transparent 65%)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-7 flex-none items-center justify-center rounded-[9px]"
          style={{ background: alpha(CAR, 0.16), color: CAR }}
        >
          <Icon name="car" size={15} />
        </span>
        <Link to="/ev" className="min-w-0 flex-1 truncate text-[13px] text-ink-muted no-underline hover:text-ink">
          {car.name ?? carTitle(car)}
        </Link>
        {!narrow && (
          <span className="flex flex-none items-center gap-1.5 text-xs" style={{ color: status }}>
            <i
              aria-hidden
              className={cn("size-1.5 rounded-full", charging && "animate-pulse-soft")}
              style={{ background: status }}
            />
            {STATUS_LABEL[car.status]}
          </span>
        )}
      </div>
      <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
        <span
          className={
            !short && !narrow
              ? "text-[56px] leading-14 tracking-[-2.5px] max-sm:text-[44px] max-sm:leading-11"
              : "text-[40px] leading-11 tracking-[-1.5px] max-sm:text-[32px] max-sm:leading-9"
          }
        >
          {soc != null ? Math.round(soc) : "—"}
        </span>
        {soc != null && <span className="text-lg font-normal text-ink-faint">%</span>}
      </span>
      <div className="flex flex-col gap-2">
        <span className="relative block h-2.5 rounded-full bg-track">
          <span
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft"
            style={{
              width: `${Math.max(0, Math.min(100, soc ?? 0))}%`,
              background: `linear-gradient(90deg, ${alpha(CAR, 0.7)}, ${CAR})`,
            }}
          />
          {car.limit != null && (
            <span
              title={`Charges to ${car.limit}%`}
              className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${car.limit}%` }}
            />
          )}
        </span>
        {!short && (
          <span className="flex justify-between gap-2 text-xs text-ink-faint tabular-nums">
            <span className="truncate">
              {charging && car.power_kw
                ? `Drawing ${kW(car.power_kw * 1000)}`
                : car.at_home === false
                  ? "Away"
                  : "At home"}
            </span>
            {car.limit != null && !narrow && <span className="whitespace-nowrap">Charges to {car.limit}%</span>}
          </span>
        )}
      </div>
      {show.doing && !short && car.doing && (
        <span className="line-clamp-2 text-[12.5px] leading-[18px] text-pretty text-ink-soft">{car.doing}</span>
      )}
      {show.today && tall === "tall" && w >= 3 && (
        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-line-subtle pt-3">
          <div className="flex min-w-0 flex-col">
            <dt className="truncate text-[11.5px] text-ink-faint">
              {cars > 1 ? "Cars charged today" : "Charged today"}
            </dt>
            <dd className="text-[17px] font-light tabular-nums">{today ? kWh(today.total) : "—"}</dd>
            {today?.solar_share != null && today.total > 0.05 && (
              <dd className="text-[11.5px]" style={{ color: COLOR.solar }}>
                {today.solar_share > 0.98 ? "All from solar" : `${pct(today.solar_share * 100)} from solar`}
              </dd>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="truncate text-[11.5px] text-ink-faint">Charging</dt>
            <dd className="text-[17px] font-light">{MODE_LABEL[car.mode]}</dd>
            <dd className="text-[11.5px] text-ink-faint">
              {car.mode === "solar" ? "On spare sunshine" : "As the car's set"}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
