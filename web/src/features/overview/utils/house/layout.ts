import { I, type P3 } from "~/features/overview/utils/house/iso";

/*
 * Where everything goes in the isometric house, from the household's choices (Settings → System → Your
 * house): one or two storeys, no garage or a single or double one, and for each inverter and battery
 * (as many as are connected) whether it's on an outside wall or in the garage.
 *
 * Scene units: x runs to the right along the front of the house, y towards the street, z up. The house is
 * x 0..10, y 0..8; its front (y = 8) and right side (x = 10) are the walls you see. A garage joins the
 * right side, its door facing the street. Equipment hangs on a wall facing +x: the house's right side, the
 * garage's right side (outside), or the house's wall inside the garage, seen through the garage drawn as if
 * made of glass.
 */

export type Place = "wall" | "garage";

export type HouseOptions = {
  storeys: 1 | 2;
  /** Car spaces: 0 (no garage), 1 or 2. */
  garage: 0 | 1 | 2;
  /** Where each inverter is, the main (hybrid) one first; and each battery. */
  inverters: Place[];
  batteries: Place[];
};

export const DEFAULT_HOUSE: HouseOptions = { storeys: 1, garage: 0, inverters: ["wall"], batteries: ["wall"] };

export const MAX_BATTERIES = 3;
export const MAX_INVERTERS = 3;

/** A box on a wall that faces +x: the wall's x, along y from y0 to y1, and z0 to z1 up it. */
export type Unit = { x: number; y0: number; y1: number; z0: number; z1: number };

/** A run of wall equipment can hang on. */
type Wall = { x: number; y0: number; y1: number; zMax: number; inside: boolean };

export type Layout = {
  options: HouseOptions;
  /** The house's walls reach this high; its roof's eaves and ridge. */
  wallTop: number;
  eave: number;
  ridge: number;
  garage: { x0: number; x1: number; y0: number; y1: number; top: number; spaces: 1 | 2 } | null;
  /** The garage is drawn see-through: something's inside it. */
  ghostGarage: boolean;
  ground: { x0: number; x1: number; y0: number; y1: number };
  inverters: Unit[];
  batteries: Unit[];
  charger: Unit;
  /** Whether the house's right side has room left for its window. */
  sideWindow: boolean;
  /** Energy lines: roof to each inverter, and the main inverter to the batteries. */
  pvPaths: P3[][];
  batteryPaths: P3[][];
  /** Points the label pills' leader lines end at, on the drawing. */
  anchors: { solar: P3; grid: P3; home: P3; battery: P3; tesla: P3 };
  /** Scale and shift that fit the drawing in the frame a single-storey house without a garage fills. */
  fit: { scale: number; dx: number; dy: number };
};

const BATTERY_W = 1.2;
const BATTERY_H = 2.6;
const INVERTER_W = 0.8;
const INVERTER_H = 1.0;
const CHARGER_W = 0.4;
const GAP = 0.35;
const POLE: P3 = [-1.5, 9.7, 8.2];

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
  const widths = inverters * INVERTER_W + batteries * BATTERY_W + GAP * Math.max(inverters + batteries - 1, 0);
  const two = widths > wall.y1 - wall.y0 && wall.zMax >= 4.6 && inverters > 0 && batteries > 0;
  if (two) {
    const bat = along(wall, Array(batteries).fill(BATTERY_W));
    const inv = along(wall, Array(inverters).fill(INVERTER_W));
    return {
      batteries: bat.map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: 0.3, z1: 0.3 + BATTERY_H })),
      inverters: inv.map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: 3.3, z1: 3.3 + INVERTER_H })),
    };
  }
  const spots = along(wall, [...Array(inverters).fill(INVERTER_W), ...Array(batteries).fill(BATTERY_W)]);
  const invZ0 = Math.min(2.4, wall.zMax - INVERTER_H - 0.3);
  return {
    inverters: spots.slice(0, inverters).map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: invZ0, z1: invZ0 + INVERTER_H })),
    batteries: spots
      .slice(inverters)
      .map(([y0, y1]) => ({ x: wall.x, y0, y1, z0: 0.3, z1: Math.min(0.3 + BATTERY_H, wall.zMax - 0.3) })),
  };
}

const mid = (u: Unit): number => (u.y0 + u.y1) / 2;

export function layout(o: HouseOptions): Layout {
  const wallTop = o.storeys === 2 ? 9 : 5;
  const eave = wallTop - 0.45;
  const ridge = wallTop + 3;
  const gw = o.garage === 2 ? 6.6 : 3.8;
  const garage = o.garage ? { x0: 10, x1: 10 + gw, y0: 1.5, y1: 8, top: 3.3, spaces: o.garage } : null;

  // The charger hangs at the front of the outermost outside wall; equipment outside goes behind it.
  const outside: Wall = garage
    ? { x: garage.x1, y0: garage.y0 + 0.3, y1: garage.y1 - 0.3 - CHARGER_W - GAP, zMax: garage.top, inside: false }
    : { x: 10, y0: 0.4, y1: 7.6 - CHARGER_W - GAP, zMax: wallTop, inside: false };
  const inside: Wall | null = garage
    ? { x: 10, y0: garage.y0 + 0.3, y1: garage.y1 - 0.3, zMax: garage.top, inside: true }
    : null;
  const charger: Unit = {
    x: outside.x,
    y0: outside.y1 + GAP,
    y1: outside.y1 + GAP + CHARGER_W,
    z0: 1.5,
    z1: Math.min(2.3, outside.zMax - 0.4),
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

  // The house's side window stays only where nothing hangs over it (it's at y 1.26..3.54, z 1.64..3.76).
  const onHouseSide = [...inverters, ...batteries].filter((u) => u.x === 10 && !garage);
  const sideWindow = !garage && onHouseSide.every((u) => u.y0 > 3.7 || u.z0 > 3.8);

  // Solar runs from the roof's front corner down the house's side, then across the garage roof if it must.
  const roofCorner: P3 = [9.2, 8.1, eave + 0.4];
  const down: P3 = [10.03, 7.7, eave + 0.17];
  const pvPaths = inverters.map((u) => {
    const y = mid(u);
    if (u.x === 10) return [roofCorner, down, [10.03, y, eave + 0.17], [10.03, y, u.z1]] as P3[];
    const top = (garage?.top ?? 0) + 0.12;
    return [
      roofCorner,
      down,
      [10.03, 7.7, top],
      [u.x + 0.03, 7.7, top],
      [u.x + 0.03, y, top],
      [u.x + 0.03, y, u.z1],
    ] as P3[];
  });

  // The main inverter feeds each battery along the bottom of the wall (and across the floor if they're apart).
  const hybrid = inverters[0];
  const batteryPaths: P3[][] = hybrid
    ? batteries.map((b) => [
        [hybrid.x + 0.03, mid(hybrid), hybrid.z0],
        [hybrid.x + 0.03, mid(hybrid), 0.18],
        ...(hybrid.x !== b.x ? ([[b.x + 0.03, mid(hybrid), 0.18]] as P3[]) : []),
        [b.x + 0.03, mid(b), 0.18],
        [b.x + 0.03, mid(b), b.z0],
      ])
    : [];

  const ground = { x0: -2, x1: Math.max(15, (garage?.x1 ?? 10) + 2), y0: -1, y1: garage ? 11.4 : 10.4 };
  const anchors = {
    solar: [5, 6.2, ridge - 1.5] as P3,
    grid: POLE,
    home: [2.4, 8, 2.7] as P3,
    battery: batteries[0] ? ([batteries[0].x, mid(batteries[0]), (batteries[0].z0 + batteries[0].z1) / 2] as P3) : POLE,
    tesla: garage ? ([(garage.x0 + garage.x1) / 2, 9.6, 0.4] as P3) : ([13.95, 4.3, 1.0] as P3),
  };

  return {
    options: o,
    wallTop,
    eave,
    ridge,
    garage,
    ghostGarage: !!garage && [...o.inverters, ...o.batteries].includes("garage"),
    ground,
    inverters,
    batteries,
    charger,
    sideWindow,
    pvPaths,
    batteryPaths,
    anchors,
    fit: fit(ground, ridge),
  };
}

/** The drawing's extent on screen: the ground's corners (and its depth), the roof's ridge and the pole. */
function extent(ground: Layout["ground"], ridge: number) {
  const pts = [
    I(ground.x0, ground.y1, -0.5),
    I(ground.x1, ground.y0, -0.5),
    I(ground.x1, ground.y1, -0.5),
    I(-0.4, 4, ridge),
    I(10.4, 4, ridge),
    I(...POLE),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const BASE = extent({ x0: -2, x1: 15, y0: -1, y1: 10.4 }, 8);

/** Shrink a bigger house to the frame the original one fills: same middle, same ground line. */
function fit(ground: Layout["ground"], ridge: number): Layout["fit"] {
  const e = extent(ground, ridge);
  const scale = Math.min(1, (BASE.x1 - BASE.x0) / (e.x1 - e.x0), (BASE.y1 - BASE.y0) / (e.y1 - e.y0));
  const dx = (BASE.x0 + BASE.x1) / 2 - ((e.x0 + e.x1) / 2) * scale;
  const dy = BASE.y1 - e.y1 * scale;
  return { scale, dx, dy };
}

/** A point on the drawing, after the fit. */
export const fitted = (l: Layout, p: P3): [number, number] => {
  const q = I(...p);
  return [q[0] * l.fit.scale + l.fit.dx, q[1] * l.fit.scale + l.fit.dy];
};

/** A stable key for caching what's drawn for a layout. */
export const houseKey = (o: HouseOptions) =>
  `${o.storeys}-${o.garage}-${o.inverters.join(".")}-${o.batteries.join(".")}`;

const layouts = new Map<string, Layout>();
/** The layout for a house, worked out once per set of choices. */
export function layoutFor(o: HouseOptions): Layout {
  const key = houseKey(o);
  let l = layouts.get(key);
  if (!l) layouts.set(key, (l = layout(o)));
  return l;
}
