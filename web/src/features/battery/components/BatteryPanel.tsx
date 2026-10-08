import { useBatteryChange } from "~/features/battery/hooks";
import type { BatteryView } from "~/features/battery/types";
import { describeMode, KIND_COLOR, when } from "~/features/battery/utils";
import { errorMessage } from "~/features/common/api/utils";
import { batteryState, batteryTone, ON, reserveOf } from "~/features/common/energy/utils";
import { duration } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import type { BatteryMode, Snapshot, SystemInfo } from "~/features/common/live/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useToast } from "~/features/common/ui/components/Toast";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { cn } from "~/features/common/ui/utils";

type Supported = Extract<BatteryView, { supported: true }>;

/**
 * The battery at a glance, as the Solar, Home and Grid pages have theirs: its mode's icon, then its level, what it's
 * doing now, what it's set to do, the reserve it keeps, and how long what's above the reserve would run the house at
 * this use. Under them the level as a bar (the reserve it keeps, or the raised one, and a charge's target), and while a
 * control is in effect, one button back to normal and what the control will do.
 */
export function BatteryPanel({
  v,
  p,
  s,
  mode,
  now,
}: {
  v: Supported | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  mode: BatteryMode | null;
  now: number;
}) {
  const { stop } = useBatteryChange();
  const toast = useToast();
  const soc = useTween(p?.battery_soc) ?? p?.battery_soc ?? null;
  const st = batteryState(p?.battery_power);
  const cap = s?.battery_kwh;
  const c = v?.control && !v.control.ending ? v.control : null;
  const m = mode ? describeMode(mode, now) : null;
  const reserve = c?.kind === "floor" && c.floor != null ? c.floor : reserveOf(s);
  const power = p?.battery_power;
  const tone = c ? KIND_COLOR[c.kind] : st === "discharge" ? COLOR.warn : COLOR.battery;
  // Left to itself and discharging, it says so, in the amber of the power flow and the charts, rather than "Normal".
  const draining = !c && mode?.owner === "normal" && st === "discharge";
  const modeColor = c ? KIND_COLOR[c.kind] : draining ? batteryTone(p?.battery_power) : COLOR.battery;
  const load = p?.load_power;
  // Resting at the top it's allowed to charge to (the inverter's maximum, short of 100% on some): full, rather than idle.
  const full = !c && st === "idle" && soc != null && soc >= (v?.settings?.max_soc ?? 100) - 0.5;
  // What's left above the reserve, at what the house is using now.
  const left =
    soc != null && cap && load && load > ON ? ((Math.max(0, soc - reserve) / 100) * cap * 1000) / load : null;

  return (
    <SummaryCard
      icon={
        c?.kind === "standby"
          ? "pause"
          : c?.kind === "floor"
            ? "shield"
            : c?.kind === "charge"
              ? "bolt"
              : draining
                ? "batteryDraining"
                : "battery"
      }
      color={modeColor}
      label="Battery now"
      footer={
        (c || v?.blocked) && (
          <div className="flex flex-col gap-4">
            {c && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={stop.isPending}
                  onClick={() =>
                    stop.mutate(undefined, {
                      onSuccess: () => toast("The battery is back to normal."),
                      onError: (e) => toast(errorMessage(e)),
                    })
                  }
                >
                  {stop.isPending ? "Putting it back…" : "Resume normal"}
                </Button>
                {v?.plan && (
                  <span className="text-[13px] text-ink-muted tabular-nums">
                    {c.kind === "charge"
                      ? `${v.plan.reaches ? "Done" : "Stops"} at about ${when(v.plan.ends_at ?? v.plan.to, now)} · ${kWh(v.plan.charge_grid_kwh ?? 0)} from the grid, about ${money(v.plan.charge_cost ?? 0)}`
                      : `About ${money(v.plan.cost)} from the grid${v.plan.ends_at ? ` until ${when(v.plan.ends_at, now)}` : " over the next 12 hours"}`}
                  </span>
                )}
                {c.until && <span className="text-xs text-ink-faint">Back to normal at {when(c.until, now)}</span>}
              </div>
            )}
            {c && !c.confirmed && (
              <HelpText>Sent to the inverter. It can take a minute or two to show the change.</HelpText>
            )}
            {v?.blocked && <Notice tone="warn">{v.blocked}</Notice>}
          </div>
        )
      }
    >
      <SummaryStat
        label="Level"
        value={soc == null ? DASH : pct(Math.round(soc))}
        title={soc != null && cap ? `${kWh((soc / 100) * cap)} of ${kWh(cap)}` : undefined}
        sub={
          <LevelBar
            soc={soc}
            reserve={reserve}
            target={c?.kind === "charge" ? (c.target ?? null) : null}
            tone={tone}
            raised={c?.kind === "floor"}
            paused={c?.kind === "standby"}
          />
        }
      />
      <SummaryStat
        label={
          c?.kind === "standby"
            ? "On standby"
            : st === "charge"
              ? "Charging"
              : st === "discharge"
                ? "Discharging"
                : "Idle"
        }
        dot={st === "charge" ? COLOR.battery : st === "discharge" ? COLOR.warn : undefined}
        value={full ? "Full" : power == null ? DASH : kW(Math.abs(power))}
        sub={
          full
            ? (p?.pv_power ?? 0) > ON
              ? "Solar's running the house"
              : "Topped up"
            : st === "charge"
              ? "Into the battery"
              : st === "discharge"
                ? "Powering your home"
                : "Nothing in or out"
        }
      />
      <SummaryStat
        label="Mode"
        value={m ? m.label : DASH}
        color={c ? modeColor : undefined}
        sub={m?.detail ?? undefined}
        title={m?.detail ?? undefined}
      />
      <SummaryStat
        label="Reserve"
        value={pct(reserve)}
        sub={c?.kind === "floor" ? "Raised for now" : "For when the grid's down"}
      />
      <SummaryStat
        label="Lasts"
        value={left != null ? duration(left * 3600) : DASH}
        sub={left != null ? "At this use" : "Down to the reserve"}
      />
    </SummaryCard>
  );
}

/**
 * The level as a slim bar in the Level figure, in place of its line: the reserve it keeps marked (lilac while it's
 * raised), and a charge's target. As tall as the line it takes the place of, so the figures stay level.
 */
function LevelBar({
  soc,
  reserve,
  target,
  tone,
  raised,
  paused,
}: {
  soc: number | null;
  reserve: number;
  target: number | null;
  tone: string;
  raised: boolean;
  paused: boolean;
}) {
  const w = Math.max(0, Math.min(100, soc ?? 0));
  return (
    <span className="relative flex h-4 items-center">
      <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-track">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft",
            paused && "opacity-60",
          )}
          style={{ width: `${w}%`, background: `linear-gradient(90deg, ${alpha(tone, 0.55)}, ${tone})` }}
        />
      </span>
      <Marker at={reserve} color={raised ? KIND_COLOR.floor : alpha(COLOR.fg, 0.55)} />
      {target != null && <Marker at={target} color={KIND_COLOR.charge} />}
    </span>
  );
}

function Marker({ at, color }: { at: number; color: string }) {
  return (
    <span
      aria-hidden
      className="absolute top-0.5 h-3 w-[2px] -translate-x-1/2 rounded-full"
      style={{ left: `${at}%`, background: color }}
    />
  );
}
