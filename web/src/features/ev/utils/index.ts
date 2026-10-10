import { COLOR } from "~/features/common/theme/utils/colors";
import type {
  BluelinkStatus,
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

export const EVENT_COLOR: Record<NonNullable<EvEvent["kind"]>, string> = {
  solar: COLOR.solar,
  manual: COLOR.warn,
  mode: COLOR.inkMuted,
  error: COLOR.bad,
  trip: COLOR.battery,
  charge: COLOR.good,
  wake: COLOR.lilac,
};
