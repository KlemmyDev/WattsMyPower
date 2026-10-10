import { errorMessage } from "~/features/common/api/utils";
import { DASH, kW, kWh } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { CarSteps } from "~/features/ev/components/CarSteps";
import { EvChargeBar } from "~/features/ev/components/EvChargeBar";
import { useEvChange, useRefreshDetails } from "~/features/ev/hooks";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import type { EvBrand, EvVehicle } from "~/features/ev/types";
import type { Reached } from "~/features/ev/components/ProviderChip";
import { carMood, STATUS_LABEL } from "~/features/ev/utils";

/** While it waits for spare solar: how closely it's followed, so it's clear why it's (not) being kept awake. */
function readiness(v: EvVehicle, provider: Reached | null): string | null {
  if (v.night && v.status !== "charging")
    return "Left to sleep overnight: checked every half hour without waking it. Wake it to read it now.";
  if (v.status !== "waiting") return null;
  if (provider === "hyundai" || provider === "kia") {
    if (v.follow === "ready") return "Checked every 5 minutes, to start once the sun's spare";
    if (v.solar_from != null) return `Spare solar expected from ${hhmm(v.solar_from)}`;
    return "No spare solar expected for it soon";
  }
  const bt = provider === "bluetooth";
  if (v.follow === "ready")
    return bt ? "Kept awake and checked each minute, to start quickly" : "Checked each minute, to start quickly";
  if (v.wake_at != null && v.solar_from != null)
    return `${bt ? "Left to sleep" : "Checked every 5 minutes"} until ${hhmm(v.wake_at)}: spare solar expected from ${hhmm(v.solar_from)}`;
  return bt ? "Left to sleep: no spare solar expected for it soon" : "No spare solar expected for it soon";
}

/** How fresh what's shown is: asleep or not, when its charge was read, and when it was last checked (over Bluetooth,
 * the car's checked without waking it far more often than its charge is read). */
function freshness(v: EvVehicle, provider: Reached | null): string {
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
          ? `Asleep, and didn't wake for the dashboard: left to sleep until ${hhmm(v.no_wake_until)}`
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

/**
 * Waking the car, by hand: its charge and details are read now (and it then stays awake a while). Over Bluetooth it's
 * otherwise only woken for spare solar by day, or when something's sent to it, never in the background at night.
 */
function WakeButton({ v }: { v: EvVehicle }) {
  const wake = useRefreshDetails();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={wake.isPending}
        onClick={() => wake.mutate({ vin: v.vin, wake: true })}
      >
        {wake.isPending ? "Waking the car…" : "Wake car"}
      </Button>
      <HelpText tone={wake.isError ? "bad" : undefined}>
        {wake.isError
          ? errorMessage(wake.error)
          : wake.isSuccess
            ? "Woken and read. It stays awake for a while, then sleeps again."
            : "Reads it now. It stays awake for a while after."}
      </HelpText>
    </div>
  );
}

/**
 * An EV at the top of its page, as the other pages' summaries are: its icon and colour say where it is between asleep,
 * awake and charging (the card brightest while it charges, its icon breathing), then its charge, what it's charging
 * at, what this charge has added, its limit, and while it follows the sun what's spare for it. Under them the three
 * steps with the one it's at lit, the charge bar with its limit handle, and what it's doing in a sentence.
 */
export function EvPanel({
  v,
  provider = null,
  brand = "tesla",
}: {
  v: EvVehicle;
  provider?: Reached | null;
  brand?: EvBrand;
}) {
  const { command } = useEvChange(brand);
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  const mood = carMood({ status: v.status, mode: v.control.mode, asleep: s?.asleep, charging: s?.charging });
  const charging = mood.step === "charging";
  const power = charging ? (s?.power_kw ?? 0) * 1000 : null;
  const ready = readiness(v, provider);
  return (
    <SummaryCard
      icon={mood.icon}
      color={mood.color}
      wash={mood.wash}
      live={charging}
      label={`${v.name ?? "Your EV"}: ${STATUS_LABEL[v.status]}`}
      footer={
        <div className="flex flex-col gap-4 border-t border-line-subtle pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CarSteps step={mood.step} color={mood.color} detail={power != null ? kW(power) : null} />
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
          </div>
          <EvChargeBar
            v={v}
            soc={soc}
            fill={charging ? mood.color : COLOR.battery}
            brand={brand}
            charging={charging}
            asleep={mood.step === "asleep"}
          />
          <div className="flex flex-col gap-1">
            <span className="text-sm text-pretty text-ink">{v.doing}</span>
            {ready && <span className="text-[13px] text-pretty text-ink-muted">{ready}</span>}
            <span className="text-xs text-ink-faint tabular-nums">{freshness(v, provider)}</span>
          </div>
          {command.isError && <HelpText tone="bad">{errorMessage(command.error)}</HelpText>}
        </div>
      }
    >
      <SummaryStat
        label={v.name ?? "Charge"}
        value={soc == null ? DASH : `${Math.round(soc)}%`}
        sub={s?.range_km != null ? `${s.range_km} km` : undefined}
      />
      <SummaryStat
        label="Charging"
        value={power != null ? kW(power) : "Off"}
        color={power != null ? mood.color : undefined}
        sub={power != null ? (s?.amps != null ? `at ${s.amps} A` : undefined) : s?.plugged ? "Plugged in" : "Unplugged"}
      />
      {s?.energy_added != null && <SummaryStat label="Added" value={kWh(s.energy_added)} sub="This charge" />}
      <SummaryStat
        label="Limit"
        value={s?.limit != null ? `${Math.round(s.limit)}%` : DASH}
        sub={charging && s?.minutes_to_full ? `Full in ${duration(s.minutes_to_full * 60)}` : undefined}
      />
      {v.control.mode === "solar" && v.spare_w != null && (
        <SummaryStat
          label="Spare solar"
          value={kW(Math.max(0, v.spare_w))}
          sub={v.min_w != null ? `Starts at ${kW(v.min_w)}` : undefined}
        />
      )}
    </SummaryCard>
  );
}
