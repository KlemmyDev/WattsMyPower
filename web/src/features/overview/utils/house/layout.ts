import { I, type P3 } from "~/features/overview/utils/house/iso";
import type { RoofColour, WallFinish } from "~/features/overview/utils/house/palette";

/*
 * Where everything goes in the isometric house, from the household's choices (Settings → Your house): its style,
 * one or two storeys, no garage or a single or double garage or carport, how many solar panels, a pool, and for each
 * inverter and battery (as many as are connected) whether it's on an outside wall or in the garage.
 *
 * Scene units: x runs to the right along the front of the house, y towards the street, z up. Every style's
 * house sits in x 0..10 with its front towards the street and its right side (x = 10) the wall you see (a
 * townhouse's neighbour joins its left side). A garage joins the right side, its door facing the street. Equipment
 * hangs on a wall facing +x: the house's right side, the garage's right side (outside), or the house's wall inside
 * the garage, seen through the garage drawn as if made of glass.
 *
 * What differs between styles is the house's Shape (below); the styles draw it (styles/*.ts).
 */

export type Place = "wall" | "garage";
/** Where a car would rather park. */
export type Park = "garage" | "outside";
export type HouseStyle =
  "estate" | "brick" | "modern" | "coastal" | "queenslander" | "federation" | "bungalow" | "farmhouse" | "townhouse";
/** A garage with walls and a roller door, or a carport: a roof of clear sheeting on posts. */
export type GarageKind = "garage" | "carport";
export type Fence = "none" | "picket" | "slat" | "hedge";
/** The trees: round leafy ones, gums, palms, or none. */
export type Garden = "leafy" | "native" | "tropical" | "minimal";

export type HouseOptions = {
  style: HouseStyle;
  storeys: 1 | 2;
  /** Car spaces: 0 (no garage), 1 or 2; and whether they're a garage or a carport. */
  garage: 0 | 1 | 2;
  garageKind: GarageKind;
  /** The walls' finish and the roof's colour, or null for the style's own. */
  walls: WallFinish | null;
  roof: RoofColour | null;
  /** How many solar panels to draw: as many of them as fit on the sides of the roof you can see. */
  panels: number;
  /** A pool in the side garden. */
  pool: boolean;
  /** Along the street, and the trees: null for the style's own. */
  fence: Fence | null;
  garden: Garden | null;
  /** Where each inverter is, the main (hybrid) one first; and each battery. */
  inverters: Place[];
  batteries: Place[];
  /** Where each connected car would rather park, in the order they were connected. */
  cars: Park[];
};

export const DEFAULT_HOUSE: HouseOptions = {
  style: "estate",
  storeys: 1,
  garage: 0,
  garageKind: "garage",
  walls: null,
  roof: null,
  panels: 14,
  pool: false,
  fence: null,
  garden: null,
  inverters: ["wall"],
  batteries: ["wall"],
  cars: [],
};

export const MAX_INVERTERS = 3;
export const MAX_OUTSIDE = 2; // car spots outside, beside the outermost wall
export const MAX_PANELS = 60;

/** Where a car parks: a rectangle on the ground (the car's length along y), in the garage or outside. */
export type Spot = { x0: number; x1: number; y0: number; y1: number; garage: boolean };

/** A box on a wall that faces +x: the wall's x, along y from y0 to y1, and z0 to z1 up it. */
export type Unit = { x: number; y0: number; y1: number; z0: number; z1: number };

/** A run of wall equipment can hang on: from y0 to y1 along it, and zMin to zMax up it. */
type Wall = { x: number; y0: number; y1: number; zMin: number; zMax: number; inside: boolean };

/** A window on the house's right side: one that equipment would cover isn't drawn. */
export type SideWindow = { y0: number; y1: number; z0: number; z1: number };

/** What a style's house is like, as far as the rest of the drawing needs to know. */
export type Shape = {
  /** The right side (x = 10): where along it and how high equipment can hang without a garage. */
  side: { y0: number; y1: number; zMin: number; zMax: number };
  sideWindows: SideWindow[];
  /** The highest point of the house, for fitting the drawing in the frame. */
  top: number;
  /** The solar line's way off the roof to the top of the right side, ending on it (x 10.03). */
  roofOut: P3[];
  /** Where the power line from the pole meets the house. */
  gridAt: P3;
  /** How far towards the street the ground reaches (a verandah and its stairs need more). */
  groundY1: number;
  /** Where the front path meets the street, from x0 to x1: the gap in a fence. */
  gate: [number, number];
  /** The house's leftmost point (a townhouse's neighbour reaches well past x 0), for the ground and the frame. */
  left: number;
  /** Joined to a neighbour on the left: no room there for a pool, or for the tree behind. */
  attached?: boolean;
};

export type Layout = {
  options: HouseOptions;
  shape: Shape;
  garage: { x0: number; x1: number; y0: number; y1: number; top: number; spaces: 1 | 2; kind: GarageKind } | null;
  /** The garage is drawn see-through: something's inside it. (A carport's clear roof always is.) */
  ghostGarage: boolean;
  ground: { x0: number; x1: number; y0: number; y1: number };
  /** The pool in the side garden, if there is one: its water, inside the coping. */
  pool: { x0: number; x1: number; y0: number; y1: number } | null;
  inverters: Unit[];
  batteries: Unit[];
  charger: Unit;
  /** The house's side windows that nothing hangs over, so are drawn. */
  sideWindows: SideWindow[];
  /** Energy lines: roof to each inverter, and the main inverter to each battery. */
  pvPaths: P3[][];
  batteryPaths: P3[][];
  /** Where cars park: each garage space, then the spots outside (as many as the cars that park there need, and
   * one to show where a car would go when there's no garage). */
  spots: Spot[];
  /** The spot each car parks in (its index in `spots`), in the order of `options.cars`; -1 where there's no room. */
  parked: number[];
  /** Scale and shift that fit the drawing in the frame a single-storey house without a garage fills. */
  fit: { scale: number; dx: number; dy: number };
};

const BATTERY_W = 1.2;
const BATTERY_H = 2.6;
const INVERTER_W = 0.8;
const INVERTER_H = 1.0;
const CHARGER_W = 0.4;
const GAP = 0.35;
export const POLE: P3 = [-1.5, 9.7, 8.2];

// ------------------------------------------------------------------------------------------ the styles' shapes

/** The estate home's walls and roof: a gable roof along its length over plain walls. */
export function estateLevels(storeys: 1 | 2) {
  const wallTop = storeys === 2 ? 9 : 5;
  return { wallTop, eave: wallTop - 0.45, ridge: wallTop + 3 };
}

function estate(storeys: 1 | 2): Shape {
  const { wallTop, eave, ridge } = estateLevels(storeys);
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: wallTop },
    sideWindows: [
      { y0: 1.26, y1: 3.54, z0: 1.64, z1: 3.76 },
      ...(storeys === 2 ? [{ y0: 1.26, y1: 3.54, z0: 5.64, z1: 7.76 }] : []),
    ],
    top: ridge,
    roofOut: [
      [9.2, 8.1, eave + 0.4],
      [10.03, 7.7, eave + 0.17],
    ],
    gridAt: [0.9, 8.03, 3.4],
    groundY1: 10.4,
    gate: [5.2, 6.4],
    left: -0.4,
  };
}

/** The brick-and-tile home's levels: face brick under a hip roof of concrete tiles, its entry set back under the
 * eaves behind a brick pier. */
export function brickLevels(storeys: 1 | 2) {
  const wallTop = storeys === 2 ? 7.4 : 3.9;
  return {
    wallTop,
    ridge: wallTop + 2.6,
    eaves: { x0: -0.5, x1: 10.5, y0: -0.5, y1: 8.55 },
    ridgeLine: { x0: 3.7, x1: 6.3, y: 4.0 },
    // the entry, set back from the front wall, with a pier at its open corner
    porch: { x0: 3.3, x1: 5.7, y: 6.7 },
  };
}

function brick(storeys: 1 | 2): Shape {
  const b = brickLevels(storeys);
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: b.wallTop },
    sideWindows: [
      { y0: 1.3, y1: 3.4, z0: 1.3, z1: 2.9 },
      ...(storeys === 2 ? [{ y0: 1.3, y1: 3.4, z0: 4.8, z1: 6.4 }] : []),
    ],
    top: b.ridge,
    roofOut: [
      [10.35, 8.4, b.wallTop + 0.1],
      [10.03, 7.7, b.wallTop - 0.15],
    ],
    gridAt: [0.6, 8.03, 2.9],
    groundY1: 10.4,
    gate: [4.0, 5.0],
    left: -0.5,
  };
}

/** The modern home's boxes: rendered, under a flat roof, the upper floor reaching out over the front. */
export function modernBoxes(storeys: 1 | 2) {
  const lower = { x0: 0, x1: 10, y0: 0, y1: 8, z0: 0, z1: storeys === 2 ? 3.6 : 3.8 };
  const upper = storeys === 2 ? { x0: 0, x1: 10, y0: 0.6, y1: 9.2, z0: 3.75, z1: 7.3 } : null;
  const roof = upper ?? lower;
  return { lower, upper, roofZ: roof.z1, roofTop: roof.z1 + 0.35 };
}

function modern(storeys: 1 | 2): Shape {
  const { upper, roofZ, roofTop } = modernBoxes(storeys);
  const front = upper ? upper.y1 : 8;
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: upper ? upper.z1 : 3.8 },
    sideWindows: [{ y0: 1.0, y1: 4.6, z0: 2.3, z1: 3.2 }, ...(upper ? [{ y0: 1.4, y1: 8.6, z0: 4.4, z1: 6.8 }] : [])],
    top: roofTop + 0.75, // the panels' frames stand above the roof
    roofOut: [
      [9.7, front + 0.2, roofTop],
      [10.03, front - 0.3, roofZ - 0.1],
      ...(upper ? ([[10.03, 7.7, upper.z0]] as P3[]) : []),
    ],
    gridAt: [0.45, 8.03, 3.0],
    groundY1: 10.4,
    gate: [0.9, 1.9],
    left: -0.35,
  };
}

/** The coastal home's levels: a skillion roof falling to the street over weatherboards and timber, glass across the
 * front onto a deck. The roof's height at y is `roofAt(y)`. */
export function coastalLevels(storeys: 1 | 2) {
  const low = storeys === 2 ? 6.7 : 3.5; // the front wall's top
  const high = low + 2.3; // the back wall's
  const roofAt = (y: number) => low + ((8 - y) * (high - low)) / 8;
  return { low, high, roofAt, floor: storeys === 2 ? 3.35 : null, deck: { x0: 3.6, x1: 10, y1: 10.1, z: 0.3 } };
}

function coastal(storeys: 1 | 2): Shape {
  const c = coastalLevels(storeys);
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: c.low },
    sideWindows: [
      { y0: 1.0, y1: 3.6, z0: 1.2, z1: 2.8 },
      ...(c.floor ? [{ y0: 1.0, y1: 3.6, z0: c.floor + 1.2, z1: c.floor + 2.8 }] : []),
    ],
    top: c.roofAt(-0.6) + 0.3,
    roofOut: [
      [10.2, 7.6, c.roofAt(7.6) + 0.3],
      [10.03, 7.3, c.roofAt(7.3) - 0.2],
    ],
    gridAt: [0.4, 8.03, c.low - 0.6],
    groundY1: 10.8,
    gate: [1.4, 2.4],
    left: -0.5,
  };
}

/** The Queenslander's levels: weatherboards on stumps (built in underneath when it's two storeys) under a hip
 * roof of iron, with a verandah across the front and stairs down to the garden. */
export function queenslanderLevels(storeys: 1 | 2) {
  const floor = storeys === 2 ? 3.0 : 1.6;
  const wallTop = floor + 3.3;
  const rise = storeys === 2 ? 0.3 : 0.2;
  return { floor, wallTop, ridge: wallTop + 2.6, front: 7, deck: 9.2, rise, steps: Math.ceil(floor / rise) };
}

function queenslander(storeys: 1 | 2): Shape {
  const q = queenslanderLevels(storeys);
  return {
    side: { y0: 0.4, y1: 6.6, zMin: 0, zMax: q.wallTop },
    sideWindows: [{ y0: 1.3, y1: 3.6, z0: q.floor + 0.9, z1: q.floor + 2.7 }],
    top: q.ridge,
    roofOut: [
      [10.25, 7.25, q.wallTop + 0.08],
      [10.03, 6.9, q.wallTop - 0.15],
    ],
    gridAt: [0.6, q.front + 0.03, q.wallTop - 0.8],
    groundY1: q.deck + q.steps * 0.28 + 0.6,
    gate: [4.5, 5.5],
    left: -0.5,
  };
}

/** The Federation home's levels: red brick under a terracotta hip roof, a bay under a front gable, a chimney. */
export function federationLevels(storeys: 1 | 2) {
  const wallTop = storeys === 2 ? 7.6 : 4.0;
  return {
    wallTop,
    ridge: wallTop + 3.0,
    // the hip roof: eaves all round, a short ridge along the middle
    eaves: { x0: -0.4, x1: 10.4, y0: -0.4, y1: 8.5 },
    ridgeLine: { x0: 3.5, x1: 6.5, y: 4.05 },
    // the bay: brick walls out from the front, under a gable facing the street
    bay: { x0: 6, x1: 9.6, y1: 9.4, gable: wallTop + 2.0, peak: 7.8 },
    chimney: { x0: 1.6, x1: 2.4, y0: 2.2, y1: 3.0, top: wallTop + 4.0 },
  };
}

function federation(storeys: 1 | 2): Shape {
  const f = federationLevels(storeys);
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: f.wallTop },
    sideWindows: [
      { y0: 1.3, y1: 3.5, z0: 1.4, z1: 3.2 },
      ...(storeys === 2 ? [{ y0: 1.3, y1: 3.5, z0: 5.0, z1: 6.8 }] : []),
    ],
    top: f.chimney.top + 0.3,
    roofOut: [
      [10.3, 8.4, f.wallTop + 0.1],
      [10.03, 7.7, f.wallTop - 0.15],
    ],
    gridAt: [0.7, 8.03, 3.0],
    groundY1: 11.0,
    gate: [2.6, 3.6],
    left: -0.4,
  };
}

/** The Californian bungalow's levels: a low gable facing the street over brick walls, shingles in the gable, and a
 * porch under its own gable on deep tapered piers. The main ridge runs front to back at x 5. */
export function bungalowLevels(storeys: 1 | 2) {
  const wallTop = storeys === 2 ? 6.9 : 3.6;
  return {
    wallTop,
    ridge: wallTop + 3.1,
    eaves: { x0: -0.5, x1: 10.5, y0: -0.5, y1: 8.6 },
    porch: { x0: 0.5, x1: 5.1, y1: 10.3, beam: 3.0, peak: 4.7 },
  };
}

function bungalow(storeys: 1 | 2): Shape {
  const b = bungalowLevels(storeys);
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: b.wallTop },
    sideWindows: [
      { y0: 1.2, y1: 3.2, z0: 1.3, z1: 2.9 },
      { y0: 4.4, y1: 6.4, z0: 1.3, z1: 2.9 },
      ...(storeys === 2
        ? [
            { y0: 1.2, y1: 3.2, z0: 4.6, z1: 6.2 },
            { y0: 4.4, y1: 6.4, z0: 4.6, z1: 6.2 },
          ]
        : []),
    ],
    top: b.ridge,
    roofOut: [
      [10.25, 7.9, b.wallTop + 0.12],
      [10.03, 7.6, b.wallTop - 0.15],
    ],
    gridAt: [0.25, 8.03, b.wallTop - 0.25],
    groundY1: 11.0,
    gate: [2.2, 3.4],
    left: -0.5,
  };
}

/** The farmhouse's levels: dark cladding under a steep standing-seam gable roof. */
export function farmhouseLevels(storeys: 1 | 2) {
  const wallTop = storeys === 2 ? 7.0 : 3.6;
  return { wallTop, eave: wallTop - 0.3, ridge: wallTop + 4.0, floor: storeys === 2 ? 3.5 : null };
}

function farmhouse(storeys: 1 | 2): Shape {
  const f = farmhouseLevels(storeys);
  return {
    side: { y0: 0.4, y1: 7.6, zMin: 0, zMax: f.wallTop },
    sideWindows: [
      { y0: 1.2, y1: 3.2, z0: 1.0, z1: 2.6 },
      ...(f.floor ? [{ y0: 1.2, y1: 3.2, z0: f.floor + 0.9, z1: f.floor + 2.5 }] : []),
    ],
    top: f.ridge,
    roofOut: [
      [9.2, 8.2, f.eave + 0.4],
      [10.03, 7.7, f.eave + 0.15],
    ],
    gridAt: [0.4, 8.03, 2.6],
    groundY1: 10.4,
    gate: [1.5, 2.5],
    left: -0.3,
  };
}

/** The townhouse's levels: render below and cladding above, the upper floor set back behind a balcony, under a
 * skillion roof falling to the street, between fire walls; its neighbour, the other half, joins its left side from
 * x `-NEIGHBOUR` to 0. A single-storey one is a villa unit. The roof's height at y is `roofAt(y)`. */
export const NEIGHBOUR = 6;
export function townhouseLevels(storeys: 1 | 2) {
  const lower = 3.3;
  const upper = storeys === 2 ? { z0: lower, z1: lower + 3.3, y1: 6.9 } : null;
  const top = upper ? upper.z1 : lower;
  const front = upper ? upper.y1 : 8;
  const fall = 1.3; // the roof's rise from front to back
  const roofAt = (y: number) => top + 0.15 + ((front - y) * fall) / front;
  return { lower, upper, front, roofAt };
}

function townhouse(storeys: 1 | 2): Shape {
  const t = townhouseLevels(storeys);
  return {
    side: { y0: 0.4, y1: t.upper ? t.upper.y1 - 0.4 : 7.6, zMin: 0, zMax: t.upper ? t.upper.z1 : t.lower },
    sideWindows: [
      { y0: 1.2, y1: 3.4, z0: 1.2, z1: 2.6 },
      ...(t.upper ? [{ y0: 1.2, y1: 3.4, z0: t.upper.z0 + 1.0, z1: t.upper.z0 + 2.5 }] : []),
    ],
    top: t.roofAt(-0.5) + 0.6,
    roofOut: [
      [10.2, t.front, t.roofAt(t.front) + 0.25],
      [10.03, t.front - 0.3, t.roofAt(t.front) - 0.3],
    ],
    gridAt: [0.4, 8.03, 2.7],
    groundY1: 10.4,
    gate: [6.6, 7.6],
    left: -NEIGHBOUR - 0.4,
    attached: true,
  };
}

const SHAPES: Record<HouseStyle, (storeys: 1 | 2) => Shape> = {
  estate,
  brick,
  modern,
  coastal,
  queenslander,
  federation,
  bungalow,
  farmhouse,
  townhouse,
};

// ------------------------------------------------------------------------------------------ hanging equipment

/**
 * Hang `items` (widths along the wall) from the front of a wall backwards. If they don't fit, they all
 * shrink alike. Returns each one's [y0, y1].
 */
function along(wall: Wall, widths: number[]): [number, number][] {
  const need = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(widths.length - 1, 0);
  const room = wall.y1 - wall.y0;
  const k = need > room ? room / need : 1;
  const out: [number, number][] = [];
  let y = wall.y1;
  for (const w of widths) {
    out.push([y - w * k, y]);
    y -= (w + GAP) * k;
  }
  return out;
}

/** Inverters and batteries on one wall: side by side while they fit, else in two rows (inverters above) if
 * the wall is tall enough, else squeezed up. */
function hang(wall: Wall, inverters: number, batteries: number): { inverters: Unit[]; batteries: Unit[] } {
  const z = wall.zMin;
  const widths = inverters * INVERTER_W + batteries * BATTERY_W + GAP * Math.max(inverters + batteries - 1, 0);
  const two = widths > wall.y1 - wall.y0 && wall.zMax - z >= 4.6 && inverters > 0 && batteries > 0;
  if (two) {
    const bat = along(wall, Array(batteries).fill(BATTERY_W));
    const inv = along(wall, Array(inverters).fill(INVERTER_W));
    return {
      batteries: bat.map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: z + 0.3, z1: z + 0.3 + BATTERY_H })),
      inverters: inv.map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: z + 3.3, z1: z + 3.3 + INVERTER_H })),
    };
  }
  const spots = along(wall, [...Array(inverters).fill(INVERTER_W), ...Array(batteries).fill(BATTERY_W)]);
  const invZ0 = z + Math.min(2.4, wall.zMax - z - INVERTER_H - 0.3);
  return {
    inverters: spots.slice(0, inverters).map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: invZ0, z1: invZ0 + INVERTER_H })),
    batteries: spots
      .slice(inverters)
      .map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: z + 0.3, z1: Math.min(z + 0.3 + BATTERY_H, wall.zMax - 0.3) })),
  };
}

const mid = (u: Unit): number => (u.y0 + u.y1) / 2;

/**
 * The parking: a spot for each garage space (its own lane, the car's length along y), and outside, beside the
 * outermost wall where the charger hangs, as many spots as the cars that won't be in the garage need (at most
 * MAX_OUTSIDE), or one to show where a car would park when there's no garage. Cars that would rather park in the
 * garage fill its spaces in order; the rest, and any it has no room for, park outside while there's room. A
 * carport's spaces count as the garage's.
 */
function parking(o: HouseOptions, garage: { x0: number; x1: number; y0: number; spaces: 1 | 2 } | null) {
  const lanes = garage ? garage.spaces : 0;
  const inside: number[] = [];
  const outside: number[] = [];
  o.cars.forEach((p, i) => (p === "garage" && inside.length < lanes ? inside : outside).push(i));
  const out = Math.min(MAX_OUTSIDE, Math.max(garage ? 0 : 1, outside.length));
  const spots: Spot[] = [];
  if (garage) {
    const lane = (garage.x1 - garage.x0) / lanes;
    for (let k = 0; k < lanes; k++) {
      const cx = garage.x0 + lane * (k + 0.5);
      spots.push({ x0: cx - 1.15, x1: cx + 1.15, y0: garage.y0 + 0.35, y1: garage.y0 + 6.05, garage: true });
    }
  }
  // Beside a garage, towards the street, by the charger at the front of its wall, clear of what hangs behind it;
  // without one, beside the house on the driveway.
  const wall = garage?.x1 ?? 10;
  const [y0, y1] = garage ? [5.0, 10.7] : [1.35, 7.05];
  for (let k = 0; k < out; k++) {
    const x0 = wall + 1.4 + k * 2.75;
    spots.push({ x0, x1: x0 + 2.3, y0, y1, garage: false });
  }
  const parked = o.cars.map(() => -1);
  inside.forEach((i, k) => (parked[i] = k));
  outside.slice(0, out).forEach((i, k) => (parked[i] = lanes + k));
  return { spots, parked };
}
const covers = (u: Unit, w: SideWindow) => u.y0 < w.y1 && u.y1 > w.y0 && u.z0 < w.z1 && u.z1 > w.z0;

export function layout(o: HouseOptions): Layout {
  const shape = SHAPES[o.style](o.storeys);
  const gw = o.garage === 2 ? 6.6 : 3.8;
  const carport = o.garageKind === "carport";
  const garage = o.garage
    ? { x0: 10, x1: 10 + gw, y0: 1.5, y1: 8, top: carport ? 2.9 : 3.3, spaces: o.garage, kind: o.garageKind }
    : null;
  const { spots, parked } = parking(o, garage);

  // The charger hangs at the front of the outermost outside wall; equipment outside goes behind it. A carport has
  // no walls of its own: everything hangs on the house's wall under it.
  const s = shape.side;
  const outside: Wall =
    garage && !carport
      ? {
          x: garage.x1,
          y0: garage.y0 + 0.3,
          y1: garage.y1 - 0.3 - CHARGER_W - GAP,
          zMin: 0,
          zMax: garage.top,
          inside: false,
        }
      : {
          x: 10,
          y0: Math.max(s.y0, garage ? garage.y0 + 0.3 : 0),
          y1: s.y1 - CHARGER_W - GAP,
          zMin: s.zMin,
          zMax: garage ? Math.min(s.zMax, garage.top) : s.zMax,
          inside: false,
        };
  const inside: Wall | null =
    garage && !carport
      ? { x: 10, y0: garage.y0 + 0.3, y1: garage.y1 - 0.3, zMin: 0, zMax: garage.top, inside: true }
      : null;
  const charger: Unit = {
    x: outside.x,
    y0: outside.y1 + GAP,
    y1: outside.y1 + GAP + CHARGER_W,
    z0: outside.zMin + 1.5,
    z1: outside.zMin + Math.min(2.3, outside.zMax - outside.zMin - 0.4),
  };

  // Each wall's share of the inverters and batteries, hung there in the order they're connected.
  const inverters: Unit[] = [];
  const batteries: Unit[] = [];
  const isIn = (p: Place) => !!inside && p === "garage";
  for (const wall of inside ? [outside, inside] : [outside]) {
    const inv = o.inverters.flatMap((p, i) => (isIn(p) === wall.inside ? [i] : []));
    const bat = o.batteries.flatMap((p, i) => (isIn(p) === wall.inside ? [i] : []));
    const hung = hang(wall, inv.length, bat.length);
    inv.forEach((i, k) => (inverters[i] = hung.inverters[k]));
    bat.forEach((i, k) => (batteries[i] = hung.batteries[k]));
  }

  // The house's side windows, but for any a garage hides or equipment hangs over.
  const onSide = [...inverters, ...batteries, ...(garage && !carport ? [] : [charger])].filter((u) => u.x === 10);
  const sideWindows = shape.sideWindows.filter(
    (w) => !onSide.some((u) => covers(u, w)) && !(garage && w.z0 < garage.top + 0.3 && w.y1 > garage.y0),
  );

  // Solar comes off the roof and down the house's side, then across the garage roof if it must.
  const down = shape.roofOut[shape.roofOut.length - 1];
  const pvPaths = inverters.map((u) => {
    const y = mid(u);
    if (u.x === 10) return [...shape.roofOut, [10.03, y, down[2] ?? 0], [10.03, y, u.z1]] as P3[];
    const top = (garage?.top ?? 0) + 0.12;
    return [
      ...shape.roofOut,
      [10.03, down[1], top],
      [u.x + 0.03, down[1], top],
      [u.x + 0.03, y, top],
      [u.x + 0.03, y, u.z1],
    ] as P3[];
  });

  // The main inverter feeds each battery along the bottom of the wall (and across the floor if they're apart).
  const hybrid = inverters[0];
  const batteryPaths: P3[][] = hybrid
    ? batteries.map((b) => {
        const low = Math.min(hybrid.z0, b.z0) - 0.12;
        return [
          [hybrid.x + 0.03, mid(hybrid), hybrid.z0],
          [hybrid.x + 0.03, mid(hybrid), low],
          ...(hybrid.x !== b.x ? ([[b.x + 0.03, mid(hybrid), low]] as P3[]) : []),
          [b.x + 0.03, mid(b), low],
          [b.x + 0.03, mid(b), b.z0],
        ];
      })
    : [];

  // A pool in the garden on the left, beside the tree behind the house (a townhouse's neighbour is there instead).
  const pool = o.pool && !shape.attached ? { x0: -6.2, x1: -2.9, y0: 1.2, y1: 6.2 } : null;
  const ground = {
    x0: Math.min(-2, shape.left - 1, pool ? pool.x0 - 0.9 : 0),
    x1: Math.max(15, (garage?.x1 ?? 10) + 2, ...spots.map((sp) => sp.x1 + 0.6)),
    y0: -1,
    y1: Math.max(shape.groundY1, garage ? 11.4 : 10.4, ...spots.map((sp) => sp.y1 + 0.6)),
  };

  return {
    options: o,
    shape,
    garage,
    // See-through when something's inside: equipment, or a car. A carport's roof is clear sheeting, so always.
    ghostGarage:
      !!garage &&
      (carport || [...o.inverters, ...o.batteries].includes("garage") || parked.some((k) => k >= 0 && spots[k].garage)),
    ground,
    pool,
    inverters,
    batteries,
    charger,
    sideWindows,
    pvPaths,
    batteryPaths,
    spots,
    parked,
    fit: fit(ground, shape),
  };
}

/** The drawing's extent on screen: the ground's corners (and its depth), the house's top and the pole. */
function extent(ground: Layout["ground"], shape: Pick<Shape, "top" | "left">) {
  const pts = [
    I(ground.x0, ground.y1, -0.5),
    I(ground.x1, ground.y0, -0.5),
    I(ground.x1, ground.y1, -0.5),
    I(shape.left, 4, shape.top),
    I(10.4, 4, shape.top),
    I(...POLE),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const BASE = extent({ x0: -2, x1: 15, y0: -1, y1: 10.4 }, { top: 8, left: -0.4 });

/** Shrink a bigger house to the frame the original one fills: same middle, same ground line. */
function fit(ground: Layout["ground"], shape: Shape): Layout["fit"] {
  const e = extent(ground, shape);
  const scale = Math.min(1, (BASE.x1 - BASE.x0) / (e.x1 - e.x0), (BASE.y1 - BASE.y0) / (e.y1 - e.y0));
  const dx = (BASE.x0 + BASE.x1) / 2 - ((e.x0 + e.x1) / 2) * scale;
  const dy = BASE.y1 - e.y1 * scale;
  return { scale, dx, dy };
}

/** A stable key for caching what's drawn for a layout. */
export const houseKey = (o: HouseOptions) =>
  [
    o.style,
    o.storeys,
    o.garage,
    o.garageKind,
    o.walls,
    o.roof,
    o.panels,
    +o.pool,
    o.fence,
    o.garden,
    o.inverters.join("."),
    o.batteries.join("."),
    o.cars.join("."),
  ].join("-");

const layouts = new Map<string, Layout>();
/** The layout for a house, worked out once per set of choices. */
export function layoutFor(o: HouseOptions): Layout {
  const key = houseKey(o);
  let l = layouts.get(key);
  if (!l) layouts.set(key, (l = layout(o)));
  return l;
}
