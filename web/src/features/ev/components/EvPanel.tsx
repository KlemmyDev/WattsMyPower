import { errorMessage } from "~/features/common/api/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { useEvChange } from "~/features/ev/hooks";
import { hhmm } from "~/features/common/formatting/utils/date";
import type { EvVehicle, TeslaProvider } from "~/features/ev/types";
import { STATUS_LABEL, statusColor } from "~/features/ev/utils";

/**
 * An EV at a glance: its charge, big, with the bar up to its limit; what it's doing in a sentence; and while it's
 * following the sun, how much is spare against what it needs to charge at all.
 */
/** While it waits for spare solar: how closely it's followed, so it's clear why it's (not) being kept awake. */
function readiness(v: EvVehicle, provider: TeslaProvider | null): string | null {
  if (v.status !== "waiting") return null;
  const bt = provider === "bluetooth";
  if (v.follow === "ready")
    return bt ? "Kept awake and checked each minute, to start quickly" : "Checked each minute, to start quickly";
  if (v.wake_at != null && v.solar_from != null)
    return `${bt ? "Left to sleep" : "Checked every 5 minutes"} until ${hhmm(v.wake_at)}: spare solar expected from ${hhmm(v.solar_from)}`;
  return bt ? "Left to sleep: no spare solar expected for it soon" : "No spare solar expected for it soon";
}

export function EvPanel({ v, provider = null }: { v: EvVehicle; provider?: TeslaProvider | null }) {
  const { command } = useEvChange();
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  const tone = statusColor(v.status, v.control.mode);
  const following = v.control.mode !== "off" && s?.plugged && s.at_home && !v.hold;
  const spare = v.spare_w != null ? Math.max(0, v.spare_w) : null;
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

      {/* The car's charge up to its limit, the rest of the bar faded. */}
      <div className="relative h-3 overflow-hidden rounded-full bg-track" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, soc ?? 0)}%`, background: s?.charging ? tone : COLOR.battery }}
        />
        {s?.limit != null && (
          <div className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `calc(${s.limit}% - 1px)` }} />
        )}
      </div>

      {following && v.min_w != null && (
        <SpareMeter spare={spare} need={v.min_w} amps={v.solar_amps} charging={!!s?.charging} />
      )}
    </Card>
  );
}

/** Spare solar against what the car needs to charge at its lowest current. */
function SpareMeter({
  spare,
  need,
  amps,
  charging,
}: {
  spare: number | null;
  need: number;
  amps: number | null;
  charging: boolean;
}) {
  const top = Math.max(need * 2, spare ?? 0, 1);
  const enough = spare != null && spare >= need;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-ink-muted">Spare solar for the car</span>
        <span className="tabular-nums">
          {spare == null
            ? "Working it out…"
            : amps
              ? `${kW(spare)} · enough for ${amps} A`
              : `${kW(spare)} of ${kW(need)} to ${charging ? "keep going" : "start"}`}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-track" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${((spare ?? 0) / top) * 100}%`,
            background: enough ? COLOR.solar : alpha(COLOR.solar, 0.45),
          }}
        />
        <div className="absolute -inset-y-1 w-px bg-ink/50" style={{ left: `${(need / top) * 100}%` }} />
      </div>
    </div>
  );
}
