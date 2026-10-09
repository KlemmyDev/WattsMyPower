import { COLOR } from "~/features/common/theme/utils/colors";
import type { EvEvent, EvMode, EvStatus, TeslaProvider } from "~/features/ev/types";

export const PROVIDER_LABEL: Record<TeslaProvider, string> = { bluetooth: "Bluetooth", tessie: "Tessie" };

/** How the cars are reached, as a page's subtitle says it. */
export const PROVIDER_VIA: Record<TeslaProvider, string> = {
  bluetooth: "Over Bluetooth",
  tessie: "Through Tessie",
};

export const MODE_LABEL: Record<EvMode, string> = {
  off: "Off",
  solar: "Spare solar",
};

export const MODE_ABOUT: Record<EvMode, string> = {
  off: "The dashboard shows the car and never tells it what to do. Charge it from the car's app as usual.",
  solar:
    "Charges only from spare solar: starts once there's enough for its lowest current, follows the sun an amp at a time, and stops when it's gone.",
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
};
