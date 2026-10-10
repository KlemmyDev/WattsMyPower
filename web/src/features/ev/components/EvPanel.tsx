import { errorMessage } from "~/features/common/api/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { EvChargeBar } from "~/features/ev/components/EvChargeBar";
import { useEvChange, useRefreshDetails } from "~/features/ev/hooks";
import { hhmm } from "~/features/common/formatting/utils/date";
import type { EvBrand, EvVehicle } from "~/features/ev/types";
import type { Reached } from "~/features/ev/components/ProviderChip";
import { STATUS_LABEL, statusColor } from "~/features/ev/utils";

/**
 * An EV at a glance: its charge, big, with the bar up to its limit; what it's doing in a sentence; and while it's
 * following the sun, how much is spare against what it needs to charge at all.
 */
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
  const tone = statusColor(v.status, v.control.mode);
  return (
    <Card aria-labelledby={`h-tp-${v.vin}`} className="gap-6 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`h-tp-${v.vin}`} className="text-sm font-medium" style={{ color: tone }}>
            {v.name ?? "Your EV"} · {STATUS_LABEL[v.status]}
          </h2>
          <div className="flex items-baseline gap-1 leading-none">
            <span className="text-[88px] font-light tracking-[-4px] tabular-nums max-sm:text-[64px] max-sm:tracking-[-3px]">
              {soc == null ? "—" : Math.round(soc)}
            </span>
            <span className="text-3xl font-light text-ink-muted">%</span>
          </div>
          <span className="text-sm text-ink-muted tabular-nums">
            {[s?.range_km != null && `${s.range_km} km`, s?.limit != null && `limit ${Math.round(s.limit)}%`]
              .filter(Boolean)
              .join(" · ") || " "}
          </span>
          <span className="text-xs text-ink-faint tabular-nums">{freshness(v, provider)}</span>
        </div>
        <div className="flex max-w-[420px] min-w-0 flex-col items-start gap-2 max-sm:max-w-none">
          {s?.charging && (
            <span className="text-[28px] leading-8 font-light tracking-[-0.5px] tabular-nums">
              {kW((s.power_kw ?? 0) * 1000)}
              <span className="ml-2 text-sm text-ink-muted">{s.amps != null ? `${s.amps} A` : ""}</span>
            </span>
          )}
          <span className="text-sm text-pretty">{v.doing}</span>
          {readiness(v, provider) && (
            <span className="-mt-1 text-[13px] text-pretty text-ink-muted">{readiness(v, provider)}</span>
          )}
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
          {command.isError && <HelpText tone="bad">{errorMessage(command.error)}</HelpText>}
        </div>
      </div>

      <EvChargeBar v={v} soc={soc} fill={s?.charging ? tone : COLOR.battery} brand={brand} />
    </Card>
  );
}
