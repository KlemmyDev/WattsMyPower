import { Link } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { batteryState, type BatteryState } from "~/features/common/energy/utils";
import { kW, kWh, pct, plural } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Switch } from "~/features/common/ui/components/Switch";
import { cn } from "~/features/common/ui/utils";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice } from "~/features/home/types";
import { ARC_SMALL, BatteryArc } from "~/features/overview/components/BatteryArc";

const MOVING = 2; // W: less is idle

/** One of the home's batteries: the home battery, or a portable one in a room. */
type OneBattery = {
  key: string;
  name: string;
  /** % charged (null: not known). */
  soc: number | null;
  /** kWh it holds full (null: not known, so it's left out of the total). */
  capacity: number | null;
  state: BatteryState | null;
  /** What it's doing, in words. */
  doing: string;
  /** For a portable one: its device, for its page and its outlets. */
  device?: HomeDevice;
};

/** The portable batteries among the Home page's devices. */
export function roomBatteries(devices: HomeDevice[] | undefined): HomeDevice[] {
  return (devices ?? []).filter((d) => d.kind === "power_station" || d.now?.battery);
}

function fromDevice(d: HomeDevice): OneBattery {
  const now = d.now;
  const b = now?.battery;
  const base = { key: `device:${d.id}`, name: d.name, capacity: b?.capacity_kwh ?? null, device: d };
  if (!now || now.stale || !now.online) return { ...base, soc: b?.soc ?? null, state: null, doing: "Not answering" };
  const house = now.power_w ?? 0;
  const panels = b?.solar_w ?? 0;
  const out = b?.output_w ?? 0;
  const from = [house >= MOVING && `${kW(house)} from the house`, panels >= MOVING && `${kW(panels)} from its panels`];
  const parts = [
    from.some(Boolean) && `Charging · ${from.filter(Boolean).join(", ")}`,
    out >= MOVING && `Powering ${d.group ?? "what's plugged in"} · ${kW(out)}`,
  ].filter(Boolean);
  const net = house + panels - out;
  return {
    ...base,
    soc: b?.soc ?? null,
    state: net >= MOVING ? "charge" : net <= -MOVING ? "discharge" : "idle",
    doing: parts.length ? parts.join("; ") : "Idle",
  };
}

function home(p: Snapshot | null, s: SystemInfo | undefined): OneBattery | null {
  if (!s?.battery_kwh) return null;
  const st = batteryState(p?.battery_power);
  return {
    key: "home",
    name: "Home battery",
    soc: p?.battery_soc ?? null,
    capacity: s.battery_kwh,
    state: st,
    doing:
      st === "charge"
        ? `Charging · ${kW(-(p?.battery_power ?? 0))}`
        : st === "discharge"
          ? `Powering your home · ${kW(p?.battery_power)}`
          : st === "idle"
            ? "Idle"
            : " ",
  };
}

/**
 * Every battery the home has, together: the home battery and the portable ones in rooms, what they hold between them
 * (a bar with a part for each, as long as what it holds), then each with its charge and what it's doing. A portable
 * one's outlets can be switched from here. One whose size isn't known is shown, but left out of the total.
 */
export function AllBatteries({
  p,
  s,
  devices,
  className,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  devices: HomeDevice[];
  className?: string;
}) {
  const all = [home(p, s), ...devices.map(fromDevice)].filter((b): b is OneBattery => b != null);
  const sized = all.filter((b) => b.capacity);
  const capacity = sized.reduce((a, b) => a + b.capacity!, 0);
  const stored = sized.reduce((a, b) => a + ((b.soc ?? 0) / 100) * b.capacity!, 0);
  const unsized = all.filter((b) => !b.capacity);
  return (
    <Card aria-labelledby="h-allbat" className={className}>
      <CardHeader
        title="All batteries"
        id="h-allbat"
        action={
          <span className="text-[13px] text-ink-muted">
            {all.length} {plural(all.length, "battery", "batteries")}
          </span>
        }
      />
      {capacity > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[34px] leading-10 font-semibold tracking-[-0.04em] tabular-nums">
              {pct((stored / capacity) * 100)}
            </span>
            <span className="text-sm text-ink-muted tabular-nums">
              {kWh(stored)} of {kWh(capacity)} between them
            </span>
          </div>
          {/* a part for each, as long as what it holds, filled as far as it's charged */}
          <div className="flex h-3 gap-[3px]" aria-hidden>
            {sized.map((b) => (
              <div
                key={b.key}
                className="relative h-full overflow-hidden rounded-full bg-surface-raised"
                style={{ flexGrow: b.capacity!, flexBasis: 0 }}
                title={`${b.name}: ${pct(b.soc)} of ${kWh(b.capacity)}`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                  style={{
                    width: `${Math.max(0, Math.min(100, b.soc ?? 0))}%`,
                    background: b.state === "discharge" ? COLOR.warn : COLOR.battery,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {all.map((b) => (
          <Row key={b.key} b={b} />
        ))}
      </ul>
      {unsized.length > 0 && (
        <p className="m-0 text-[13px] text-pretty text-ink-muted">
          {unsized.map((b) => b.name).join(", ")}: {plural(unsized.length, "its", "their")} size isn't known, so{" "}
          {plural(unsized.length, "it's", "they're")} not in the total.
        </p>
      )}
    </Card>
  );
}

function Row({ b }: { b: OneBattery }) {
  const d = b.device;
  return (
    <li className="flex items-center gap-3.5 border-t border-line-subtle py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="size-10 flex-none">
        <BatteryArc frac={(b.soc ?? 0) / 100} st={b.state} size={ARC_SMALL} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium">
          {d ? (
            <Link
              to="/home/$device"
              params={{ device: String(d.id) }}
              className="text-inherit no-underline hover:underline"
            >
              {b.name}
            </Link>
          ) : (
            b.name
          )}
          {d?.group && <span className="font-normal text-ink-muted"> · {d.group}</span>}
        </span>
        <span
          className={cn(
            "truncate text-[13px] tabular-nums",
            b.state === "discharge" ? "text-warn" : b.state === "charge" ? "text-link" : "text-ink-muted",
          )}
        >
          {b.doing}
        </span>
      </div>
      <div className="flex flex-none flex-col items-end gap-0.5 text-right">
        <span className="text-[17px] font-semibold tabular-nums">{pct(b.soc)}</span>
        <span className="text-xs text-ink-muted tabular-nums">
          {b.capacity && b.soc != null ? `${kWh((b.soc / 100) * b.capacity)} of ${kWh(b.capacity)}` : " "}
        </span>
      </div>
      {d && <Outlets device={d} />}
    </li>
  );
}

/** A portable battery's AC outlets, on and off (what's plugged into it), while it can be reached and says. */
function Outlets({ device }: { device: HomeDevice }) {
  const { switch: change } = useHomeChange();
  const now = device.now;
  if (!device.can_switch || !now || now.stale || !now.online || now.switched_on == null)
    return <span className="w-[52px] flex-none" />;
  return (
    <div className="flex w-[52px] flex-none flex-col items-end gap-1">
      <Switch
        on={now.switched_on}
        label={now.switched_on ? `Switch ${device.name}'s outlets off` : `Switch ${device.name}'s outlets on`}
        disabled={change.isPending}
        onChange={(on) => change.mutate({ id: device.id, on })}
      />
      <span className="text-[11px] text-ink-faint">Outlets</span>
      {change.isError && <HelpText tone="bad">{errorMessage(change.error)}</HelpText>}
    </div>
  );
}
