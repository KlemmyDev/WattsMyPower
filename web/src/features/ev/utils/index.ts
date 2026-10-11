import { COLOR } from "~/features/common/theme/utils/colors";
import type { IconName } from "~/features/common/ui/components/Icon";
import type {
  BluelinkStatus,
  EvVehicle,
  BydStatus,
  EvEvent,
  EvMode,
  EvStatus,
  KeyRole,
  TeslaProvider,
  TeslaStatus,
} from "~/features/ev/types";

/** The key's role in words: what it lets the dashboard do. */
export const ROLE_LABEL: Record<KeyRole, string> = { charging_manager: "Charging only", driver: "Driver" };

export const PROVIDER_LABEL: Record<TeslaProvider, string> = { bluetooth: "Bluetooth", tessie: "Tessie" };

export const MODE_LABEL: Record<EvMode, string> = {
  off: "Off",
  solar: "Spare solar",
};

export const STATUS_LABEL: Record<EvStatus, string> = {
  charging: "Charging",
  waiting: "Waiting",
  stopped: "Not charging",
  complete: "Charged",
  unplugged: "Unplugged",
  away: "Away",
  hold: "On hold",
  unknown: "Not read yet",
};

/** What a Tesla's offered for, until one's connected. */
export const TESLA_ABOUT =
  "Over Bluetooth or through Tessie: its level, its charging at home, and charging it from spare solar";

/** The Teslas at a glance, for Integrations: whether they're connected and reading, each car's level and how it
 * charges ("Model Y · 80% · Spare solar"), and how they're reached (either way, until one's connected). */
export function teslaSummary(status: TeslaStatus | undefined): {
  connected: boolean;
  on: boolean;
  status: string;
  detail: string;
  reach: ("bluetooth" | "cloud")[];
} {
  const connected = !!status?.connected;
  const detail = (status?.vehicles ?? [])
    .map((v) =>
      [v.name ?? "Tesla", v.state?.soc != null && `${Math.round(v.state.soc)}%`, MODE_LABEL[v.control.mode]]
        .filter(Boolean)
        .join(" · "),
    )
    .join(", ");
  return {
    connected,
    on: connected && !status?.error,
    status: !connected ? "" : status?.error ? "Not updating" : "Connected",
    detail: connected ? detail || "No cars yet" : TESLA_ABOUT,
    reach: !connected ? ["bluetooth", "cloud"] : status?.provider === "bluetooth" ? ["bluetooth"] : ["cloud"],
  };
}

/** What a BYD's offered for, until one's connected. */
export const BYD_ABOUT = "Through BYD's cloud, as the BYD app reads it: each car's charge, range and charging";

/** The BYDs at a glance, for Integrations: whether they're connected and reading, and each car's level and what it's
 * doing ("Atto · 64% · Charging"). Always through BYD's cloud, as there's no local way. */
export function bydSummary(status: BydStatus | undefined): {
  connected: boolean;
  on: boolean;
  status: string;
  detail: string;
} {
  const connected = !!status?.connected;
  const detail = (status?.vehicles ?? [])
    .map((v) =>
      [v.name ?? v.model ?? "BYD", v.state?.soc != null && `${Math.round(v.state.soc)}%`, STATUS_LABEL[v.status]]
        .filter(Boolean)
        .join(" · "),
    )
    .join(", ");
  return {
    connected,
    on: connected && !status?.error,
    status: !connected ? "" : status?.signed_out ? "Sign in again" : status?.error ? "Not updating" : "Connected",
    detail: !connected ? BYD_ABOUT : status?.signed_out ? (status.error ?? "") : detail || "No cars yet",
  };
}

/** What a Hyundai or Kia's offered for, until one's connected. */
export const BLUELINK_ABOUT =
  "Through Bluelink or Kia Connect, as their apps reach the car: its charge and charging, and charging it from spare solar";

/** The Hyundais and Kias at a glance, for Integrations: whether they're connected and reading, and each car's level
 * and how it charges ("Ioniq · 64% · Spare solar"). Always through the maker's cloud, as there's no local way. */
export function bluelinkSummary(status: BluelinkStatus | undefined): {
  connected: boolean;
  on: boolean;
  status: string;
  detail: string;
} {
  const connected = !!status?.connected;
  const detail = (status?.vehicles ?? [])
    .map((v) =>
      [v.name ?? v.model ?? v.make, v.state?.soc != null && `${Math.round(v.state.soc)}%`, MODE_LABEL[v.control.mode]]
        .filter(Boolean)
        .join(" · "),
    )
    .join(", ");
  return {
    connected,
    on: connected && !status?.error,
    status: !connected ? "" : status?.signed_out ? "Sign in again" : status?.error ? "Not updating" : "Connected",
    detail: !connected ? BLUELINK_ABOUT : status?.signed_out ? (status.error ?? "") : detail || "No cars yet",
  };
}

/** The app a car's make is driven from, as the dashboard names it in "…in the Tesla app". */
export function appName(make: string): string {
  return make === "Hyundai" ? "Bluelink" : make === "Kia" ? "Kia Connect" : make;
}

/** What the EV section's called: the make of the cars connected ("Tesla"), or EV with none, or a mix. */
export function evTitle(cars: { make?: string | null }[] | null | undefined): string {
  const makes = new Set(cars?.map((c) => c.make).filter(Boolean));
  return makes.size === 1 ? [...makes][0]! : "EV";
}

/** What a car is: its make and model ("Tesla Model Y"). */
export const carTitle = (v: { make: string; model: string | null }) => (v.model ? `${v.make} ${v.model}` : v.make);

/** The colour of what the car's doing: solar while it's charging from the sun, battery-blue when charged. */
export function statusColor(status: EvStatus, mode: EvMode): string {
  if (status === "charging") return mode === "off" ? COLOR.battery : COLOR.solar;
  if (status === "complete") return COLOR.good;
  if (status === "hold") return COLOR.warn;
  return COLOR.inkMuted;
}

/**
 * The power there is for a car now (W, including what it's drawing), from the latest inverter reading, as the server
 * works it out (app.features.tesla.control.spare_w) but without waiting for it: what the car draws, plus what's going
 * to the grid, less what the home battery gives; with the home battery first, less what it could still take until
 * it's full; shared, less its share of what it could take. The server goes by its average over a few minutes.
 */
export function spareNow(
  p: { grid_power: number | null; battery_power: number | null; battery_soc: number | null } | null,
  v: EvVehicle,
  batteryMaxW: number,
): number | null {
  if (p?.grid_power == null) return null;
  const s = v.state;
  const volts = s?.charging && v.volts ? v.volts : null;
  const carW = s?.charging && volts && v.phases ? (s.actual_amps ?? s.amps ?? 0) * volts * v.phases : 0;
  let out = carW - p.grid_power - (p.battery_power ?? 0);
  const first = v.control.first;
  if (batteryMaxW > 0 && first === "battery" && p.battery_soc != null && p.battery_soc < v.control.battery_full)
    out -= batteryMaxW;
  else if (batteryMaxW > 0 && first === "shared")
    out -= (v.share?.battery ?? 0) * Math.min(Math.max(out, 0), batteryMaxW);
  return out;
}

/** Where a car is between asleep, awake and charging: the three steps the EV page shows it on. */
export type CarStep = "asleep" | "awake" | "charging";

/**
 * How a car looks at the top of its page, from what it's doing: the step it's at (asleep, awake, charging), its colour
 * and icon, and how strongly its card's washed in that colour. Asleep is the moon's blue and quiet; awake is the car's
 * own lilac; charging is the charge's colour (the sun's on solar) and strongest. Away, unplugged, charged and on hold
 * keep the step the car's at but take their own colour and icon.
 */
export function carMood(v: { status: EvStatus; mode?: EvMode; asleep?: boolean | null; charging?: boolean | null }): {
  step: CarStep;
  color: string;
  icon: IconName;
  wash: number;
} {
  const step: CarStep = v.charging || v.status === "charging" ? "charging" : v.asleep ? "asleep" : "awake";
  if (step === "charging") return { step, color: statusColor("charging", v.mode ?? "off"), icon: "bolt", wash: 0.18 };
  if (v.status === "away") return { step, color: COLOR.inkMuted, icon: "pin", wash: 0.05 };
  if (v.status === "hold") return { step, color: COLOR.warn, icon: "pause", wash: 0.1 };
  if (v.status === "complete") return { step, color: COLOR.good, icon: "check", wash: 0.1 };
  if (step === "asleep") return { step, color: COLOR.moon, icon: "moon", wash: 0.07 };
  if (v.status === "unplugged") return { step, color: COLOR.lilac, icon: "plug", wash: 0.08 };
  return { step, color: COLOR.lilac, icon: "car", wash: 0.1 };
}

export const EVENT_COLOR: Record<NonNullable<EvEvent["kind"]>, string> = {
  solar: COLOR.solar,
  manual: COLOR.warn,
  mode: COLOR.inkMuted,
  error: COLOR.bad,
  trip: COLOR.battery,
  charge: COLOR.good,
  wake: COLOR.lilac,
};
