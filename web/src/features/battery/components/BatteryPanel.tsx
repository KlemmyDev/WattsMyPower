import { useBatteryChange } from "~/features/battery/hooks";
import type { BatteryView } from "~/features/battery/types";
import { describeMode, KIND_COLOR, when } from "~/features/battery/utils";
import { errorMessage } from "~/features/common/api/utils";
import { batteryState, reserveOf } from "~/features/common/energy/utils";
import { kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import type { BatteryMode, Snapshot, SystemInfo } from "~/features/common/live/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { useToast } from "~/features/common/ui/components/Toast";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { cn } from "~/features/common/ui/utils";

type Supported = Extract<BatteryView, { supported: true }>;

/**
 * The battery at a glance, big: its level, what it's doing, and what it's set to do, with one button back to normal
 * while a control is in effect. The bar shows the reserve it keeps (or the raised one) and a charge's target.
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
  const doing =
    c?.kind === "standby"
      ? "On standby"
      : st === "charge"
        ? `Charging · ${kW(-(p?.battery_power ?? 0))}`
        : st === "discharge"
          ? `Powering your home · ${kW(p?.battery_power)}`
          : st === "idle"
            ? "Idle"
            : " ";
  const tone = c ? KIND_COLOR[c.kind] : st === "discharge" ? COLOR.warn : COLOR.battery;

  return (
    <Card aria-labelledby="h-batpanel" className="gap-6 overflow-hidden">
      <h2 id="h-batpanel" className="sr-only">
        Battery now
      </h2>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium" style={{ color: st === "discharge" && !c ? COLOR.warn : undefined }}>
            {doing}
          </span>
          <div className="flex items-baseline gap-1 leading-none">
            <span className="text-[88px] font-light tracking-[-4px] tabular-nums max-sm:text-[64px] max-sm:tracking-[-3px]">
              {soc == null ? "—" : Math.round(soc)}
            </span>
            <span className="text-3xl font-light text-ink-muted">%</span>
          </div>
          <span className="text-sm text-ink-muted tabular-nums">
            {soc != null && cap ? `${kWh((soc / 100) * cap)} of ${kWh(cap)}` : " "}
          </span>
        </div>

        {m && (
          <div className="flex max-w-[420px] flex-col items-start gap-3 max-sm:max-w-none">
            <div className="flex items-center gap-3">
              <span
                className="flex size-11 flex-none items-center justify-center rounded-full"
                style={{
                  background: alpha(c ? KIND_COLOR[c.kind] : COLOR.battery, 0.18),
                  color: c ? KIND_COLOR[c.kind] : COLOR.battery,
                }}
              >
                <Icon
                  name={
                    c?.kind === "standby"
                      ? "pause"
                      : c?.kind === "floor"
                        ? "shield"
                        : c?.kind === "charge"
                          ? "bolt"
                          : "battery"
                  }
                  size={20}
                />
              </span>
              <div className="flex flex-col">
                <span className="text-xl font-semibold tracking-[-0.3px]">{m.label}</span>
                <span className="text-sm text-pretty text-ink-muted">{m.detail ?? " "}</span>
              </div>
            </div>
            {c && (
              <Button
                variant="outline"
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
            )}
            {c && v?.plan && (
              <span className="text-sm text-ink-muted tabular-nums">
                {c.kind === "charge"
                  ? `${v.plan.reaches ? "Done" : "Stops"} at about ${when(v.plan.ends_at ?? v.plan.to, now)} · ${kWh(v.plan.charge_grid_kwh ?? 0)} from the grid, about ${money(v.plan.charge_cost ?? 0)}`
                  : `About ${money(v.plan.cost)} from the grid${v.plan.ends_at ? ` until ${when(v.plan.ends_at, now)}` : " over the next 12 hours"}`}
              </span>
            )}
            {c && !c.confirmed && (
              <HelpText>Sent to the inverter. It can take a minute or two to show the change.</HelpText>
            )}
          </div>
        )}
      </div>

      <LevelBar
        soc={soc}
        reserve={reserve}
        target={c?.kind === "charge" ? (c.target ?? null) : null}
        tone={tone}
        raised={c?.kind === "floor"}
        paused={c?.kind === "standby"}
      />
      {c?.until && <span className="-mt-3 text-xs text-ink-faint">Back to normal at {when(c.until, now)}</span>}
      {v?.blocked && <Notice tone="warn">{v.blocked}</Notice>}
    </Card>
  );
}

/** The level as a wide bar, with the reserve marked (lilac while it's raised) and a charge's target. */
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
    <div className="flex flex-col gap-2">
      <div className="relative h-14 overflow-hidden rounded-2xl bg-track max-sm:h-11">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-2xl transition-[width] duration-700 ease-out-soft",
            paused && "opacity-60",
          )}
          style={{
            width: `${w}%`,
            background: `linear-gradient(90deg, ${alpha(tone, 0.55)}, ${tone})`,
          }}
        />
        {paused && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 opacity-25"
            style={{
              width: `${w}%`,
              backgroundImage: `repeating-linear-gradient(135deg, ${COLOR.fg} 0 2px, transparent 2px 9px)`,
            }}
          />
        )}
        <Marker at={reserve} color={raised ? KIND_COLOR.floor : alpha(COLOR.fg, 0.55)} />
        {target != null && <Marker at={target} color={KIND_COLOR.charge} />}
      </div>
      <div className="relative h-4 text-xs text-ink-muted">
        <MarkerLabel at={reserve}>Reserve {pct(reserve)}</MarkerLabel>
        {target != null && <MarkerLabel at={target}>Charging to {pct(target)}</MarkerLabel>}
      </div>
    </div>
  );
}

function Marker({ at, color }: { at: number; color: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-1.5 w-[3px] -translate-x-1/2 rounded-full"
      style={{ left: `${at}%`, background: color }}
    />
  );
}

function MarkerLabel({ at, children }: { at: number; children: React.ReactNode }) {
  return (
    <span
      className={cn("absolute whitespace-nowrap", at < 12 ? "" : at > 88 ? "-translate-x-full" : "-translate-x-1/2")}
      style={{ left: `${at}%` }}
    >
      {children}
    </span>
  );
}
