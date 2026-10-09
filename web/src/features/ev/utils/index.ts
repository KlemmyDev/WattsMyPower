import { COLOR } from "~/features/common/theme/utils/colors";
import type { EvEvent, EvMode, EvStatus, KeyRole, TeslaProvider } from "~/features/ev/types";

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
