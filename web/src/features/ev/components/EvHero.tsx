import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import {
  HeroBar,
  HeroCard,
  HeroFigures,
  HeroFill,
  HeroKey,
  HeroLead,
  HeroLive,
  HeroStat,
  HeroStats,
  HeroTick,
  HeroTop,
} from "~/features/common/ui/components/Hero";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { cn } from "~/features/common/ui/utils";
import { homeUsageQuery } from "~/features/home/api";
import { levelsQuery } from "~/features/ev/api";
import { CarSteps } from "~/features/ev/components/CarSteps";
import { EvChargeBar } from "~/features/ev/components/EvChargeBar";
import { EvDayChart } from "~/features/ev/components/EvDayChart";
import type { Reached } from "~/features/ev/components/ProviderChip";
import { useEvChange, useRefreshDetails, useSpareNow } from "~/features/ev/hooks";
import type { EvBrand, EvLevels, EvVehicle } from "~/features/ev/types";
import { carMood, carTitle, MODE_LABEL, STATUS_LABEL } from "~/features/ev/utils";

const ROLLUP_KWH = 5 / 60 / 1000; // each of the car's power readings is five minutes' average (W)

/** While it waits for spare solar: how closely it's followed, so it's clear why it's (not) being kept awake. */
export function readiness(v: EvVehicle, provider: Reached | null): string | null {
  if (provider === "bluetooth" && v.state?.in_range === false && v.status !== "charging")
    return "Away. Listened for each minute, so it's back here soon after you get home.";
  if (v.night && v.status !== "charging")
    return "Left to sleep overnight. It's checked every half hour without waking it, or wake it to read it now.";
  if (v.status !== "waiting") return null;
  if (provider === "hyundai" || provider === "kia") {
    if (v.follow === "ready") return "Checked every 5 minutes, ready to start once there's spare sun";
    if (v.solar_from != null) return `Spare solar expected from ${hhmm(v.solar_from)}`;
    return "No spare solar expected for it soon";
  }
  const bt = provider === "bluetooth";
  if (v.follow === "ready")
    return bt ? "Kept awake and checked each minute, to start quickly" : "Checked each minute, to start quickly";
  if (v.wake_at != null && v.solar_from != null)
    return `${bt ? "Left to sleep" : "Checked every 5 minutes"} until ${hhmm(v.wake_at)}. Spare solar expected from ${hhmm(v.solar_from)}`;
  return bt ? "Left to sleep. No spare solar expected for it soon" : "No spare solar expected for it soon";
}

/** How fresh what's shown is: asleep or not, when its charge was read, and when it was last checked (over Bluetooth,
 * the car's checked without waking it far more often than its charge is read). */
export function freshness(v: EvVehicle, provider: Reached | null): string {
  const s = v.state;
  if (provider === "hyundai" || provider === "kia")
    // The cloud only has what the car last sent it: when it did, and when the cloud was last read.
    return [
      s?.as_of ? `Sent by the car ${hhmm(s.as_of)}` : "Not sent by the car yet",
      v.seen_at && `cloud checked ${hhmm(v.seen_at)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const parts = [
    // The link's held open (plugged in at home by day): the dashboard keeps its place among the few connections
    // the car takes, and reads it without finding and connecting first.
    v.linked && provider === "bluetooth" && s?.in_range !== false ? "Connected" : null,
    s?.in_range === false && v.seen_at
      ? `Not heard since ${hhmm(v.seen_at)}`
      : s?.asleep
        ? v.no_wake_until
          ? `Asleep and didn't wake for the dashboard, so left to sleep until ${hhmm(v.no_wake_until)}`
          : "Asleep"
        : null,
    s?.as_of ? `charge read ${hhmm(s.as_of)}` : "charge not read yet",
    v.seen_at && s?.in_range !== false && (!s?.as_of || v.seen_at - s.as_of > 90)
      ? `${provider === "bluetooth" ? "checked" : "Tessie read"} ${hhmm(v.seen_at)}`
      : null,
  ].filter(Boolean) as string[];
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What went into the car at home today from its five-minute readings: in all, and of it from the grid (kWh). */
function chargedToday(day: EvLevels | undefined) {
  if (!day) return null;
  const kwh = day.power.reduce((a, r) => a + r.w, 0) * ROLLUP_KWH;
  const grid = day.power.reduce((a, r) => a + r.grid_w, 0) * ROLLUP_KWH;
  return { kwh, grid, share: kwh >= 0.05 ? Math.max(0, 1 - grid / kwh) : null };
}

/**
 * What the car took at home today, and what it cost: a Tesla's from its own readings; a Hyundai or Kia's, when it's
 * the only car, from what the house saw go to the car. The cost is only known when it's the only car (the house's
 * figure is all of them together).
 */
function useToday(v: EvVehicle, brand: EvBrand, alone: boolean, now: number) {
  const start = midnight(now);
  const end = addDays(start, 1);
  const { data: day } = useQuery({ ...levelsQuery(v.vin, start, end), enabled: brand === "tesla" });
  const { data: usage } = useQuery({ ...homeUsageQuery(start, end, "hour"), enabled: alone });
  const own = chargedToday(day && day.start === start ? day : undefined);
  const house = alone ? usage?.car : null;
  const kwh = own?.kwh ?? house?.total ?? null;
  return {
    kwh,
    share: own ? own.share : house && house.total >= 0.05 ? house.solar_share : null,
    grid: own ? own.grid : house?.solar_share != null ? house.total * (1 - house.solar_share) : null,
    cost: house ? house.cost : null,
  };
}

/** "2.10 kW" as a figure and its unit. */
const split = (text: string) => {
  const [value, unit] = text.split(" ");
  return { value, unit };
};

/**
 * Waking the car, by hand: its charge and details are read now (and it then stays awake a while). Over Bluetooth it's
 * otherwise only woken for spare solar by day, or when something's sent to it, never in the background at night.
 */
function WakeButton({ v }: { v: EvVehicle }) {
  const wake = useRefreshDetails();
  return (
    <div className="flex flex-col items-end gap-1 max-sm:items-start">
      <Button
        size="sm"
        variant="outline"
        disabled={wake.isPending}
        title="Reads it now. It stays awake for a while after."
        onClick={() => wake.mutate({ vin: v.vin, wake: true })}
      >
        {wake.isPending ? "Waking the car…" : "Wake car"}
      </Button>
      {(wake.isError || wake.isSuccess) && (
        <HelpText tone={wake.isError ? "bad" : undefined}>
          {wake.isError ? errorMessage(wake.error) : "Woken and read. It stays awake a while, then sleeps again."}
        </HelpText>
      )}
    </div>
  );
}

/**
 * A car today and now, in one card, as Solar's, Home's and Battery's: its charge (plugged in or not, how it charges),
 * what it's charging at now (or, following the sun, what's spare for it; else what it's doing), its range, what it took
 * at home today, how much of that was sun and what it cost; its charge along a bar with the limit as a handle you drag
 * (and, charging, where it's heading); where it is between asleep, awake and charging, with what it's doing in a
 * sentence; and for a Tesla, unless `chart` is off, its day. `compact` (several cars, or a dashboard widget): the bar's
 * only shown, with no buttons, and the whole card opens the car's own page.
 */
export function EvHero({
  v,
  provider = null,
  brand = "tesla",
  alone = true,
  now,
  chart = true,
  compact = false,
}: {
  v: EvVehicle;
  provider?: Reached | null;
  brand?: EvBrand;
  /** It's the only car connected: what the house saw go to cars today is all its own. */
  alone?: boolean;
  now: number;
  chart?: boolean;
  compact?: boolean;
}) {
  const { command } = useEvChange(brand);
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  const mood = carMood({ status: v.status, mode: v.control.mode, asleep: s?.asleep, charging: s?.charging });
  const charging = mood.step === "charging";
  const asleep = mood.step === "asleep";
  const solar = v.control.mode === "solar";
  const live = useSpareNow(v);
  const spare = solar ? (live ?? v.spare_w) : null;
  const today = useToday(v, brand, alone, now);
  const name = v.name ?? carTitle(v);
  // EV's coral at rest, the charge's own colour (the sun's on solar) while it charges, the moon's blue asleep.
  const tint = charging ? mood.color : asleep ? COLOR.moon : COLOR.danger;
  const limit = s?.limit != null ? Math.round(s.limit) : null;
  const fullAt = charging && s?.minutes_to_full ? now + s.minutes_to_full * 60 : null;
  const where = s?.at_home === false ? "Away" : s?.plugged ? "Plugged in" : "Unplugged";
  const ready = compact ? null : readiness(v, provider);
  const fill = charging ? mood.color : COLOR.battery;

  const legend = (
    <>
      {limit != null && <HeroKey mark="tick">Charges to {pct(limit)}</HeroKey>}
      {fullAt != null && limit != null ? (
        <HeroKey mark="dashed" color={mood.color}>
          At {pct(limit)} by {hhmm(fullAt)}
        </HeroKey>
      ) : solar && !charging && v.solar_from != null && v.solar_from > now ? (
        <HeroKey mark="dot" color={COLOR.solar}>
          Spare solar expected from {hhmm(v.solar_from)}
        </HeroKey>
      ) : null}
    </>
  );

  return (
    <HeroCard
      label={`${name} today and now`}
      tint={tint}
      wash={charging ? 0.14 : asleep ? 0.06 : 0.1}
      className={cn(
        "relative",
        compact &&
          "transition-[translate,border-color] duration-200 hover:-translate-y-0.5 hover:border-fg/15 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand",
      )}
    >
      {compact && (
        <Link
          to="/ev/$vin"
          params={{ vin: v.vin }}
          aria-label={`Open ${name}`}
          className="absolute inset-0 z-1 rounded-[inherit] outline-none"
        />
      )}
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label={compact ? name : "Charge"}
            value={soc == null ? DASH : Math.round(soc)}
            unit={soc == null ? undefined : "%"}
            sub={
              <>
                {where}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
                    !solar && !v.hold && "bg-fg/6 text-ink-muted",
                  )}
                  style={
                    v.hold
                      ? { background: alpha(COLOR.warn, 0.14), color: COLOR.warn }
                      : solar
                        ? { background: alpha(COLOR.solar, 0.14), color: COLOR.solar }
                        : undefined
                  }
                >
                  {v.hold ? "On hold" : MODE_LABEL[v.control.mode]}
                </span>
              </>
            }
          />
          {charging ? (
            <HeroLive
              label="Charging now"
              on
              color={mood.color}
              {...split(kW((s?.power_kw ?? 0) * 1000))}
              sub={
                [s?.amps != null && `at ${s.amps} A`, s?.energy_added != null && `${kWh(s.energy_added)} this charge`]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
          ) : solar && spare != null && s?.at_home !== false && (spare > 0 || v.follow === "ready") ? (
            <HeroLive
              label="Spare solar now"
              on={v.min_w != null && spare >= v.min_w}
              color={COLOR.solar}
              {...split(kW(Math.max(0, spare)))}
              sub={v.min_w != null ? `Starts at ${kW(v.min_w)}` : undefined}
            />
          ) : (
            <HeroLive
              label="Right now"
              on={false}
              color={mood.color}
              value={asleep ? "Asleep" : STATUS_LABEL[v.status]}
              sub={s?.as_of ? `Charge read ${hhmm(s.as_of)}` : undefined}
            />
          )}
        </HeroFigures>
        <HeroStats>
          <HeroStat
            label="Range"
            value={s?.range_km != null ? `${Math.round(s.range_km)} km` : DASH}
            sub={
              s?.range_km != null && soc && limit && limit > soc
                ? `About ${Math.round((s.range_km / soc) * limit)} km at ${pct(limit)}`
                : undefined
            }
          />
          <HeroStat
            label="Charged today"
            value={today.kwh != null ? kWh(today.kwh) : DASH}
            sub={today.kwh != null && today.kwh < 0.05 ? "Nothing yet" : today.kwh != null ? "At home" : undefined}
          />
          <HeroStat
            label="Sun or battery"
            value={today.share != null ? pct(today.share * 100) : DASH}
            sub={today.grid != null && today.share != null ? `${kWh(today.grid)} from the grid` : undefined}
          />
          {today.cost != null ? (
            <HeroStat label="Cost today" value={money(today.cost)} sub="At your rates" />
          ) : (
            charging &&
            s?.minutes_to_full != null && (
              <HeroStat
                label="Full in"
                value={duration(s.minutes_to_full * 60)}
                sub={limit != null ? `To ${pct(limit)}` : undefined}
              />
            )
          )}
        </HeroStats>
      </HeroTop>
      {compact ? (
        <HeroBar legend={legend}>
          {fullAt != null && limit != null && (
            <HeroFill from={soc ?? 0} to={limit} color={mood.color} variant="dashed" />
          )}
          <HeroFill
            to={soc ?? 0}
            color={fill}
            className={cn(asleep && "opacity-45")}
            style={{ background: `linear-gradient(90deg, ${alpha(fill, 0.55)}, ${fill})` }}
          />
          {limit != null && <HeroTick at={limit} title="Its charge limit" />}
        </HeroBar>
      ) : (
        <EvChargeBar
          v={v}
          soc={soc}
          fill={fill}
          brand={brand}
          charging={charging}
          asleep={asleep}
          expect={fullAt != null ? limit : null}
          legend={legend}
          className="@max-xl:-order-1"
        />
      )}
      {/* Where it is between asleep, awake and charging, what it's doing, and how fresh that is. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <CarSteps step={mood.step} color={mood.color} detail={charging ? kW((s?.power_kw ?? 0) * 1000) : null} />
        <div className="flex min-w-[min(100%,240px)] flex-1 flex-col gap-0.5">
          <span className={cn("text-sm text-pretty text-ink", compact && "line-clamp-1")}>{v.doing}</span>
          {ready && <span className="text-[13px] text-pretty text-ink-muted">{ready}</span>}
          {!compact && <span className="text-xs text-ink-faint tabular-nums">{freshness(v, provider)}</span>}
        </div>
        {!compact && (
          <div className="flex flex-wrap items-start gap-3">
            {s?.asleep && s.in_range !== false && <WakeButton v={v} />}
            {v.hold && v.control.mode !== "off" && (
              <Button
                size="sm"
                variant="outline"
                disabled={command.isPending}
                onClick={() => command.mutate({ vin: v.vin, action: "resume" })}
              >
                Let the dashboard take over
              </Button>
            )}
          </div>
        )}
      </div>
      {command.isError && <HelpText tone="bad">{errorMessage(command.error)}</HelpText>}
      {chart && !compact && brand === "tesla" && <EvDayChart v={v} now={now} />}
    </HeroCard>
  );
}
