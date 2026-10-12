import { Link } from "@tanstack/react-router";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { DASH } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import {
  HeroBar,
  HeroCard,
  HeroFigures,
  HeroFill,
  HeroLead,
  HeroLive,
  HeroStat,
  HeroStats,
  HeroTop,
} from "~/features/common/ui/components/Hero";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { cn } from "~/features/common/ui/utils";
import { CarSteps } from "~/features/ev/components/CarSteps";
import type { BydCar } from "~/features/ev/types";
import { carMood, STATUS_LABEL } from "~/features/ev/utils";

/** How fresh what's shown is: when the car last sent its state to BYD, and whether it's reachable now. */
function freshness(v: BydCar): string {
  const s = v.state;
  if (!s) return "Not heard from yet";
  return [s.as_of ? `Charge read ${hhmm(s.as_of)}` : "Charge read", !s.online && "the car's offline now"]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A BYD today and now, as BYD's cloud last had it, on the same card as the other cars: its charge, whether it's
 * charging and how long until it's full, its range and odometer; its charge along a bar; and where it is between
 * asleep (offline), awake and charging, with what it's doing in a sentence. Only read: the dashboard can't charge a
 * BYD from spare solar (BYD's cloud can't stop a charge or set its current), so there's nothing to set here.
 * `compact`: the whole card opens the car's own page.
 */
export function BydHero({ v, compact = false }: { v: BydCar; compact?: boolean }) {
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  // Offline to BYD's cloud is as near as it says to asleep.
  const mood = carMood({ status: v.status, asleep: s ? !s.online : false, charging: s?.charging });
  const charging = mood.step === "charging";
  const asleep = mood.step === "asleep";
  const name = v.name ?? v.model ?? "Your BYD";
  const tint = charging ? mood.color : asleep ? COLOR.moon : COLOR.danger;
  const fill = charging ? mood.color : COLOR.battery;
  const toFull = charging && s?.minutes_to_full ? duration(s.minutes_to_full * 60).split(" ") : null;
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
            sub={s?.online === false ? "Offline to BYD's cloud" : s ? "Online" : "Not heard from yet"}
          />
          <HeroLive
            label={charging ? "Charging now" : "Right now"}
            on={charging}
            color={mood.color}
            value={toFull ? toFull.slice(0, -1).join(" ") : charging ? "Charging" : STATUS_LABEL[v.status]}
            unit={toFull ? `${toFull[toFull.length - 1]} to full` : undefined}
            sub={freshness(v)}
          />
        </HeroFigures>
        <HeroStats>
          <HeroStat
            label="Range"
            value={s?.range_km != null ? `${Math.round(s.range_km)} km` : DASH}
            sub={v.hybrid ? "On the battery" : undefined}
          />
          {s?.odometer_km != null && (
            <HeroStat label="Odometer" value={`${s.odometer_km.toLocaleString("en-AU")} km`} />
          )}
        </HeroStats>
      </HeroTop>
      <HeroBar>
        <HeroFill
          to={soc ?? 0}
          color={fill}
          className={cn(asleep && "opacity-45")}
          style={{ background: `linear-gradient(90deg, ${alpha(fill, 0.55)}, ${fill})` }}
        />
      </HeroBar>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <CarSteps step={mood.step} color={mood.color} />
        <div className="flex min-w-[min(100%,240px)] flex-1 flex-col gap-0.5">
          <span className={cn("text-sm text-pretty text-ink", compact && "line-clamp-1")}>{v.doing}</span>
          {!compact && (
            <span className="text-[13px] text-pretty text-ink-muted">
              Read through BYD's cloud every 10 minutes (every 5 while it charges). The dashboard only reads it.
            </span>
          )}
        </div>
      </div>
    </HeroCard>
  );
}
