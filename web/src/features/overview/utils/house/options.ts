import { noBattery } from "~/features/battery/utils";
import type { SystemInfo } from "~/features/common/live/types";
import {
  DEFAULT_HOUSE,
  MAX_INVERTERS,
  MAX_PANELS,
  type Fence,
  type Garden,
  type HouseOptions,
  type HouseStyle,
  type Park,
  type Place,
} from "~/features/overview/utils/house/layout";
import { ROOF_COLOURS, WALL_FINISHES, type RoofColour, type WallFinish } from "~/features/overview/utils/house/palette";

export const HOUSE_STYLE_KEYS: HouseStyle[] = [
  "estate",
  "brick",
  "modern",
  "coastal",
  "queenslander",
  "federation",
  "bungalow",
  "farmhouse",
  "townhouse",
];
const FENCES: Fence[] = ["none", "picket", "slat", "hedge"];
const GARDENS: Garden[] = ["leafy", "native", "tropical", "minimal"];

/** Inverters connected: the hybrid, and a second one if there is. */
export const connectedInverters = (s: SystemInfo | undefined) => Math.min(1 + (s?.pv2 ? 1 : 0), MAX_INVERTERS);

/** Batteries: the hybrid's (a second, solar-only inverter has none), unless it's known to have none. */
export const connectedBatteries = (s: SystemInfo | undefined) => (noBattery(s) ? 0 : 1);

/** Where each of `n` units is: as chosen, else on an outside wall. */
const places = (chosen: string[] | undefined, n: number): Place[] =>
  Array.from({ length: n }, (_, i) => (chosen?.[i] === "garage" ? "garage" : "wall"));

/** Solar panels the array would have: its size over a typical panel's (440 W), at least a few. */
export const panelsFor = (pvKw: number | undefined) =>
  Math.min(Math.max(Math.round(((pvKw || 6.6) * 1000) / 440), 4), MAX_PANELS);

/** One of `allowed`, else null ("the style's own"). */
const oneOf = <T extends string>(allowed: readonly T[], v: string | undefined): T | null =>
  allowed.includes(v as T) ? (v as T) : null;

/**
 * The house to draw, from Settings → Your house, with as many inverters and batteries as are connected,
 * and where each connected car would rather park. Anything not chosen (or saved before it could be) is the style's
 * own; the panels, unless counted, are as many as the array's size needs.
 */
export function houseOptions(s: SystemInfo | undefined, cars: Park[] = []): HouseOptions {
  if (!s) return { ...DEFAULT_HOUSE, cars };
  return {
    style: HOUSE_STYLE_KEYS.includes(s.house_style) ? s.house_style : "estate",
    storeys: s.house_storeys === 2 ? 2 : 1,
    garage: Math.min(Math.max(Math.round(s.garage_spaces ?? 0), 0), 2) as 0 | 1 | 2,
    garageKind: s.garage_kind === "carport" ? "carport" : "garage",
    walls: oneOf<WallFinish>(WALL_FINISHES, s.house_walls),
    roof: oneOf<RoofColour>(ROOF_COLOURS, s.house_roof),
    panels: s.house_panels ? Math.min(Math.round(s.house_panels), MAX_PANELS) : panelsFor(s.pv_kw),
    pool: !!s.house_pool,
    fence: oneOf(FENCES, s.house_fence),
    garden: oneOf(GARDENS, s.house_garden),
    inverters: places(s.inverter_places, connectedInverters(s)),
    batteries: places(s.battery_places, connectedBatteries(s)),
    cars,
  };
}
