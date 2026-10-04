import type { SystemInfo } from "~/features/common/live/types";
import {
  DEFAULT_HOUSE,
  MAX_INVERTERS,
  type HouseOptions,
  type HouseStyle,
  type Park,
  type Place,
} from "~/features/overview/utils/house/layout";

const STYLES: HouseStyle[] = ["estate", "modern", "queenslander", "federation", "farmhouse"];

/** Inverters connected: the hybrid, and a second one if there is. */
export const connectedInverters = (s: SystemInfo | undefined) => Math.min(1 + (s?.pv2 ? 1 : 0), MAX_INVERTERS);

/** Batteries: the hybrid's (a second, solar-only inverter has none). */
export const connectedBatteries = (_s: SystemInfo | undefined) => 1;

/** Where each of `n` units is: as chosen, else on an outside wall. */
const places = (chosen: string[] | undefined, n: number): Place[] =>
  Array.from({ length: n }, (_, i) => (chosen?.[i] === "garage" ? "garage" : "wall"));

/**
 * The house to draw, from Settings → System → Your house, with as many inverters and batteries as are connected,
 * and where each connected car would rather park.
 */
export function houseOptions(s: SystemInfo | undefined, cars: Park[] = []): HouseOptions {
  if (!s) return { ...DEFAULT_HOUSE, cars };
  return {
    style: STYLES.includes(s.house_style) ? s.house_style : "estate",
    storeys: s.house_storeys === 2 ? 2 : 1,
    garage: Math.min(Math.max(Math.round(s.garage_spaces ?? 0), 0), 2) as 0 | 1 | 2,
    inverters: places(s.inverter_places, connectedInverters(s)),
    batteries: places(s.battery_places, connectedBatteries(s)),
    cars,
  };
}
