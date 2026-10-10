import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { DASH } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
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
 * A BYD at the top of the page, as BYD's cloud last had it, on the same card as the other cars: where it is between
 * asleep (offline), awake and charging, its charge, range and odometer, then its charge as a bar and what it's doing
 * in a sentence. Only read: the dashboard can't charge a BYD from spare solar (BYD's cloud can't stop a charge or set
 * its current), so there's nothing to set here.
 */
export function BydPanel({ v }: { v: BydCar }) {
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  // Offline to BYD's cloud is as near as it says to asleep.
  const mood = carMood({ status: v.status, asleep: s ? !s.online : false, charging: s?.charging });
  const charging = mood.step === "charging";
  return (
    <SummaryCard
      icon={mood.icon}
      color={mood.color}
      wash={mood.wash}
      live={charging}
      label={`${v.name ?? v.model ?? "Your BYD"}: ${STATUS_LABEL[v.status]}`}
      footer={
        <div className="flex flex-col gap-4 border-t border-line-subtle pt-5">
          <CarSteps step={mood.step} color={mood.color} />
          <div className="relative h-3 overflow-hidden rounded-full bg-track">
            <div
              className={cn(
                "absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width,opacity] duration-700 ease-out",
                mood.step === "asleep" && "opacity-45",
              )}
              style={{ width: `${Math.min(100, soc ?? 0)}%`, background: charging ? mood.color : COLOR.battery }}
            >
              {charging && <span aria-hidden className="charge-flow absolute inset-0" />}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-pretty text-ink">{v.doing}</span>
            <span className="text-[13px] text-pretty text-ink-muted">
              Read through BYD's cloud every 10 minutes (every 5 while it charges). The dashboard only reads it.
            </span>
            <span className="text-xs text-ink-faint tabular-nums">{freshness(v)}</span>
          </div>
        </div>
      }
    >
      <SummaryStat
        label={v.name ?? v.model ?? "Charge"}
        value={soc == null ? DASH : `${Math.round(soc)}%`}
        sub={s?.range_km != null ? `${s.range_km} km${v.hybrid ? " on the battery" : ""}` : undefined}
      />
      <SummaryStat
        label="Charging"
        value={charging ? "On" : "Off"}
        color={charging ? mood.color : undefined}
        sub={charging && s?.minutes_to_full ? `Full in ${duration(s.minutes_to_full * 60)}` : undefined}
      />
      {s?.odometer_km != null && <SummaryStat label="Odometer" value={`${s.odometer_km.toLocaleString()} km`} />}
    </SummaryCard>
  );
}
