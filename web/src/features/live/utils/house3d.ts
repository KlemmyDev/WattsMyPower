import type { Garden, HouseOptions, HouseStyle } from "~/features/overview/utils/house/layout";
import { FINISHES, ROOFS, type Finish, type Roof } from "~/features/overview/utils/house/palette";
import { STYLES } from "~/features/overview/utils/house/scenery";
import { clamp01, css, mix, rgb, type Rgb } from "~/features/solar/utils/sky";

/*
 * Your house in the live pages' sky, seen in perspective through a camera that can sit anywhere: low on the front
 * corner for Solar (the end of the roof in front of you, the street side with its panels running away across the sky),
 * close on the side wall for Battery (the battery and inverter), and wherever later pages want it (spots.ts). Built from
 * Settings → Your house, as the Overview's house is: its style's roof (a tiled gable or hip, corrugated or Colorbond
 * iron, a skillion, a flat roof with its panels on frames...), the roof's colour and the walls' finish (yours, or the
 * style's own), one or two storeys, a garage or carport, as many panels as you have, and the battery and inverter where
 * you said they are.
 *
 * It's lit by the real sun: each face its material's own colour, brighter the more squarely it meets the sun, warmer
 * late in the day; shadows cast along the light (the house on the lawn, the eaves on the walls, the battery and
 * inverter on theirs); soft dark where things meet; gutters, downpipes, sills, the eaves' undersides; and faceted trees
 * out to the horizon, fading into its haze.
 *
 * Scene units as the Overview house: x along the street (the house 0..10), y towards the street (its front wall at
 * y = 8), z up. The street side faces the equator, so the sun comes round the front. Faces are drawn far to near
 * within layers (ground, trees, the house, what's in front of it); what hangs on a wall is drawn with that wall, so it
 * never sorts behind it. The light of the moment (night, the warm ends of the day, rain, the garage's own light) is
 * baked into each face as it's drawn, never laid over the picture, which would show through whatever's in front.
 * Everything that stands still is one SVG string per camera and light (cached). What moves (the power along its lines,
 * the battery's level, the warmth of the glass) fills slots left in that string right after what it's on (slotMarkup),
 * so whatever's in front of it hides it.
 */

export type P3 = [number, number, number];
type P2 = [number, number];

/** Where the camera is: the eye, what it looks at, the lens (degrees across), and where on the picture that lands. */
export type Pose = { eye: P3; at: P3; fov: number; cx: number; cy: number };

/**
 * The light on the house: the sun's direction in the scene and its height (degrees), how strongly it shines (`L`, 0 at
 * night), how warm it is (low sun), the cloud over it (softening shadows), how much daylight the sky gives (`sky`), and
 * the sky's colour low down (the far trees fade into it).
 */
export type Light = {
  dir: P3;
  el: number;
  L: number;
  warm: number;
  cover: number;
  sky: number;
  horizon: Rgb;
  /** The sky's own: the sun's height on its arc (-1..1), how wet it is, and how much the moon shows. */
  es: number;
  rain: number;
  moon: number;
};

/** What moves, drawn into a slot right after what it's on: a row of panels' glass (its warmth and sheen), the power
 * along a rail, and the battery and inverter (their level, lights and power). */
export type Slot =
  | { kind: "glass"; cells: string }
  | { kind: "rail"; d: string; i: number }
  | { kind: "kit" }
  | { kind: "car"; flow: string; port: string }
  | { kind: "drop"; d: string }
  | { kind: "meter"; conduit: string; led: string };

/**
 * One shape in drawing order; `clip` keeps it to another outline (a shadow to the wall it falls on). `inside` takes the
 * garage's own light, `roof` the warm rim at the ends of the day, `own` keeps its colour as it is (the trees have their
 * own night). `raw` is markup drawn as it is, and `slot` a place for what moves.
 */
type Shape = {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  clip?: string;
  inside?: boolean;
  roof?: boolean;
  own?: boolean;
  raw?: string;
  slot?: Slot;
  /** A window pane: where it is on the picture, and how brightly it's lit at night. */
  win?: { x: number; y: number; w: number; h: number; k: number };
  /** A row of panels' glass: its cell gaps, for when they glow. */
  cells?: string;
  /** Edged in its own colour this wide, so the faces of something curved meet without a hairline between them. */
  seam?: number;
};

/** What's drawn of the moment besides the light: whether there's a car (its socket's on the wall), whether it's
 * home, and its paint. */
export type SceneParts = { ev: boolean; car: boolean; paint: string };

/** The battery and inverter as drawn: their power lines, and the battery's level bar for a level (0 to 1). */
export type Kit = {
  /** Whether it shows at all: not when its wall faces away from the camera. */
  shown: boolean;
  battery: boolean;
  dc: string;
  link: string;
  bar: (level: number) => { track: string; fill: string; up: string; led: string; status: string };
};

export type HouseArt = {
  /** The picture's size (the sky's frame). */
  w: number;
  h: number;
  /** Everything that stands still, as SVG markup, with an empty `<g data-slot>` for each of `slots`. */
  svg: string;
  slots: Slot[];
  kit: Kit | null;
  /** Where the sheen crosses the glass. */
  sheen: { x: number; cx: number; cy: number; rot: number };
};

/** The picture's size: a phone's sky, or a wider one. */
export const FRAME = { phone: { w: 600, h: 440 }, wide: { w: 1100, h: 480 } };

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addk = (a: P3, b: P3, k = 1): P3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: P3): P3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const neg = (a: P3): P3 => [-a[0], -a[1], -a[2]];
const mid = (pts: P3[]) => pts.reduce((a, q) => addk(a, q, 1 / pts.length), [0, 0, 0] as P3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: P3, b: P3, t: number): P3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();

const NEAR = 0.4;

/** A camera at `pose`, for a picture `w` wide. */
function camera(pose: Pose, w: number) {
  const { eye, at, fov, cx, cy } = pose;
  const fwd = unit(sub(at, eye));
  const right = unit(cross(fwd, [0, 0, 1]));
  const up = cross(right, fwd);
  const focal = w / 2 / Math.tan((fov * Math.PI) / 360);
  const cam = (q: P3): P3 => {
    const d = sub(q, eye);
    return [dot(d, right), dot(d, up), dot(d, fwd)];
  };
  const proj = (c: P3): P2 => [cx + (focal * c[0]) / c[2], cy - (focal * c[1]) / c[2]];
  const depth = (q: P3) => dot(sub(q, eye), fwd);
  /** A point on the picture, or null behind the camera. */
  const p = (q: P3): P2 | null => {
    const c = cam(q);
    return c[2] < NEAR ? null : proj(c);
  };
  /** A closed outline, cut where it passes behind the camera. */
  const poly = (pts: P3[]): string => {
    const c = pts.map(cam);
    const out: P3[] = [];
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (a[2] >= NEAR) out.push(a);
      if (a[2] >= NEAR !== b[2] >= NEAR) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out.length < 3 ? "" : `M${out.map((q) => proj(q).map(n1).join(" ")).join(" L")} Z`;
  };
  const seg = (a: P3, b: P3) => {
    const ca = cam(a);
    const cb = cam(b);
    if (ca[2] < NEAR || cb[2] < NEAR) return "";
    const pa = proj(ca);
    const pb = proj(cb);
    return `M${n1(pa[0])} ${n1(pa[1])} L${n1(pb[0])} ${n1(pb[1])}`;
  };
  const line = (pts: P3[]) => {
    const ps = pts.map(p);
    if (ps.some((q) => !q)) return "";
    return `M${(ps as P2[]).map((q) => q.map(n1).join(" ")).join(" L")}`;
  };
  return { eye, fwd, focal, p, poly, seg, line, depth };
}
type Cam = ReturnType<typeof camera>;

/**
 * A roof face: origin at the left end of its eave, along the eave `e` for `L`, up to its top edge by `s`. A hip
 * narrows it towards the top by `lo` and `hi` on each side.
 */
class Plane {
  readonly n: P3;
  readonly len: number;
  constructor(
    readonly o: P3,
    readonly e: P3,
    readonly L: number,
    readonly s: P3,
    readonly lo = 0,
    readonly hi = 0,
  ) {
    let n = unit(cross(e, s));
    if (n[2] < 0) n = neg(n);
    this.n = n;
    this.len = Math.hypot(...s);
  }
  P(u: number, v: number, lift = 0): P3 {
    return addk(addk(addk(this.o, this.e, u), this.s, v), this.n, lift);
  }
  ulim(v: number): [number, number] {
    return [this.lo * v, this.L - this.hi * v];
  }
  outline(): P3[] {
    const [a, b] = this.ulim(1);
    return b - a < 1e-6
      ? [this.P(0, 0), this.P(this.L, 0), this.P(a, 1)]
      : [this.P(0, 0), this.P(this.L, 0), this.P(b, 1), this.P(a, 1)];
  }
}

type Material = "tile" | "corrugated" | "rib" | "seam" | "none";

const PANEL_W = 1.05;
const PANEL_GAP = 0.07;
const PANEL_L = 1.72;
const FASCIA = "#f2efe8";
const SHADOW = "#18213a";

/** A colour as numbers: "#rrggbb", "rgb(r,g,b)" or "rgba(r,g,b,a)". */
function parseCol(col: string): number[] | null {
  if (col[0] === "#") return rgb(col);
  const m = col.match(/[\d.]+/g);
  return m ? m.map(Number) : null;
}

// ------------------------------------------------------------------------------------------------- the light

/** The light from the sky when the sun's down or behind cloud: from overhead and a little towards the street. */
const SKYLIGHT = unit([0.35, 0.55, 0.76]);

/**
 * A colour in the light: brighter the more squarely its face meets the sun, warmer late in the day, darker and cooler
 * turned away. With the sun down, the soft light from the sky still tells the faces apart. `wrap` lets the light reach
 * a little past side-on, for something rounded.
 */
function litRGB(c: Rgb, n: P3, sun: Light, wrap = 0): Rgb {
  const dir = unit(lerp3(SKYLIGHT, sun.dir, sun.L));
  const str = 0.4 + 0.6 * sun.L;
  const lam = Math.max(0, (dot(n, dir) + wrap) / (1 + wrap));
  const sky = 0.5 + 0.5 * n[2];
  const k = str * (0.7 * lam - 0.3 + 0.12 * sky);
  c = k >= 0 ? mix(c, [255, 251, 242], k * 0.6) : (c.map((v) => v * (1 + k)) as Rgb);
  c = mix(c, [255, 168, 104], sun.L * sun.warm * lam * 0.24);
  return mix(c, [104, 124, 170], str * (1 - lam) * 0.08);
}
const litColour = (fill: string, n: P3, sun: Light, wrap = 0) => css(litRGB(rgb(fill), n, sun, wrap));

/** The outline around 2D points (monotone chain). */
function hull(pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const x = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [];
  const hi: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && x(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (hi.length >= 2 && x(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// ------------------------------------------------------------------------------------------------- the layout

/** The house's look: the roof's colours and the walls', yours over the style's own; and its garden. */
function looks(o: HouseOptions): { roof: Roof; walls: Finish; garden: Garden } {
  const own = STYLES[o.style].look;
  return { roof: ROOFS[o.roof ?? own.roof], walls: FINISHES[o.walls ?? own.walls], garden: o.garden ?? own.garden };
}

/** A garage or carport on the house's right side, its door to the street. */
type Garage = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  h: number;
  t: number;
  dx0: number;
  dx1: number;
  dz: number;
  carport: boolean;
};

/** A wall the battery and inverter hang on: from its foot `o`, along it `a`, out of it `n`; the conduit runs to `top`. */
export type Mount = { o: P3; a: P3; n: P3; top: number; inside: boolean };

/** What the house is, for drawing it and for the cameras that look at it. */
export type Geometry = {
  storeys: 1 | 2;
  raised: boolean;
  /** The base of the walls and the eave's height. */
  z0: number;
  eave: number;
  garage: Garage | null;
  /** Where the battery and inverter are, and whether there's a battery. */
  mount: Mount;
  battery: boolean;
  /** Where the car parks and charges. */
  car: CarPlace;
};

/** A frame on a wall: its foot `o`, along it `a`, out of it `n`. */
type Frame = { o: P3; a: P3; n: P3 };

/**
 * Where the car parks, nose-in: on the driveway beside the house (its rear at the street, so its charge port, rear
 * left, faces the camera), or in the garage by its right-hand wall when you park it there. `x0`..`x1` across it, `cy`
 * its rear; the socket it charges from (on the house's side wall, the garage's front, or the garage's right-hand wall
 * inside); and its layers.
 */
export type CarPlace = {
  inGarage: boolean;
  x0: number;
  x1: number;
  cy: number;
  socket: Frame;
  layer: number;
  socketLayer: number;
};

const CAR_L = 4.75;
const CAR_W = 1.92;

const E = (storeys: number) => (storeys === 2 ? 5.5 : 2.6); // eave height

export function geometry(o: HouseOptions): Geometry {
  const raised = o.style === "queenslander" && o.storeys === 1;
  const z0 = raised ? 0.9 : 0;
  const eave = E(o.storeys) + z0;
  const x1 = o.garage === 2 ? 15.2 : 13.6;
  const garage: Garage | null = o.garage
    ? {
        x0: 10,
        x1,
        y0: 1,
        y1: 7,
        h: 2.5,
        t: 0.15,
        dx0: 10.5,
        dx1: x1 - 0.5,
        dz: 2.12,
        carport: o.garageKind === "carport",
      }
    : null;
  const place = o.batteries[0] ?? o.inverters[0] ?? "wall";
  let mount: Mount;
  if (garage && !garage.carport && place === "garage")
    mount = { o: [11, garage.y0 + garage.t, 0], a: [1, 0, 0], n: [0, 1, 0], top: garage.h - 0.14, inside: true };
  else if (garage && !garage.carport)
    mount = { o: [garage.x1, 3, 0], a: [0, 1, 0], n: [1, 0, 0], top: garage.h, inside: false };
  else mount = { o: [10, 4.55, 0], a: [0, 1, 0], n: [1, 0, 0], top: eave, inside: false };
  // The car parks in a garage with walls when you said it does (else on the driveway, also in front of a carport).
  const walled = garage && !garage.carport ? garage : null;
  const inGarage = !!walled && o.cars[0] === "garage";
  const x0 = walled && inGarage ? walled.x1 - walled.t - 0.65 - CAR_W : garage ? 11.95 : 11.0;
  const car: CarPlace = {
    inGarage,
    x0,
    x1: x0 + CAR_W,
    cy: walled && inGarage ? walled.y1 - 0.55 : 13.35,
    socket:
      walled && inGarage
        ? { o: [walled.x1 - walled.t, 5.55, 0], a: [0, 1, 0], n: [-1, 0, 0] }
        : walled
          ? { o: [10.12, walled.y1, 0], a: [1, 0, 0], n: [0, 1, 0] }
          : { o: [10, 7.38, z0], a: [0, 1, 0], n: [1, 0, 0] },
    layer: inGarage ? 3.4 : walled ? 5 : 1.5,
    socketLayer: inGarage ? 3 : walled ? 4.5 : 1,
  };
  return { storeys: o.storeys, raised, z0, eave, garage, mount, battery: o.batteries.length > 0, car };
}

// ------------------------------------------------------------------------------------------------- the builder

type Item = { layer: number; depth: number; shapes: Shape[]; d?: string; pts?: P3[]; n?: P3 };

class Builder {
  items: Item[] = [];
  rails: string[] = [];
  windows = 0;
  /** Drawn in layers (the ground, trees, the house, what's in front of it), far to near within each. */
  layer = 0;
  /** The walls things hang on (front and side), each one draw item. */
  wallItems: Partial<Record<"front" | "side", Item>> = {};
  /** Every roof face's corners (for the shadows they cast), and their eaves (for the undersides). */
  roofPts: P3[] = [];
  eaves: Plane[] = [];
  /** What else casts a shadow on the lawn: the car, the street's poles. */
  casters: P3[][] = [];
  /** The garage's outside wall, when the battery may hang on it. */
  garageSide: Item | null = null;
  /** Each fill's own colour before it's lit (the side shades a flat drawing bakes in go back to the face's). */
  base: Map<string, string>;
  panelsLeft: number;
  /** How dark it is, 0 by day to 0.9 at night: the windows and the porch light come on with it. */
  night: number;
  constructor(
    readonly cam: Cam,
    readonly roof: Roof,
    readonly walls: Finish,
    panels: number,
    readonly sun: Light,
  ) {
    this.panelsLeft = panels;
    this.night = clamp01(1 - sun.sky * 1.5) * 0.9;
    this.base = new Map([
      [walls.side, walls.face],
      [roof.side, roof.face],
      [roof.back, roof.face],
      ["#5c6065", "#6b6f74"],
      ["#9a4533", "#b5553f"],
      ["#a9502f", "#c8643f"],
      ["#e3dfd6", FASCIA],
      ...KIT_BASE,
    ]);
  }

  depthOf(pts: P3[]) {
    return pts.reduce((a, q) => a + this.cam.depth(q), 0) / pts.length;
  }
  facing(c: P3, n: P3) {
    return dot(sub(this.cam.eye, c), n) > 0;
  }
  add(depth: number, ...shapes: Shape[]): Item {
    const it: Item = { layer: this.layer, depth, shapes: shapes.filter((s) => s.d) };
    this.items.push(it);
    return it;
  }
  face(pts: P3[], fill: string, extra: Shape[] = [], roof = false, inside = false): Item | null {
    const d = this.cam.poly(pts);
    if (!d) return null;
    const it = this.add(
      this.depthOf(pts),
      { d, fill: inside ? fill : this.light(fill, pts), inside, roof },
      ...extra.map((x) => (inside ? { ...x, inside } : x)),
    );
    it.d = d;
    it.pts = pts;
    return it;
  }
  /** A face's colour in the light: its material's own colour, lit by how squarely it faces the sun. */
  light(fill: string, pts: P3[]): string {
    if (fill[0] !== "#") return fill;
    let n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (Math.hypot(...n) < 1e-9) return fill;
    n = unit(n);
    if (dot(sub(this.cam.eye, mid(pts)), n) < 0) n = neg(n);
    return litColour(this.base.get(fill) ?? fill, n, this.sun);
  }

  /** A roof face with its material, caps, fascia and gutter and (if it carries them) panels. */
  roofFace(
    pl: Plane,
    fill: string,
    material: Material,
    opts: { panels?: boolean; cap?: boolean; fascia?: boolean } = {},
  ) {
    this.roofPts.push(...pl.outline());
    this.eaves.push(pl);
    const centre = pl.P(pl.L / 2, 0.5);
    if (!this.facing(centre, pl.n)) return;
    const { cam, roof } = this;
    let lines = "";
    if (material === "tile") {
      const step = 0.3 / pl.len;
      let k = 0;
      for (let v = step; v < 1 - 1e-6; v += step, k++) {
        const [a, b] = pl.ulim(v);
        lines += cam.seg(pl.P(a, v), pl.P(b, v));
        const vv = Math.min(1, v + step);
        for (let u = a + (k % 2 ? 0.15 : 0); u < b - 0.05; u += 0.3) {
          const [a2, b2] = pl.ulim(vv);
          if (u >= a2 && u <= b2) lines += cam.seg(pl.P(u, v), pl.P(u, vv));
        }
      }
    } else if (material !== "none") {
      const gap = material === "corrugated" ? 0.13 : material === "rib" ? 0.3 : 0.5;
      for (let u = gap / 2; u < pl.L; u += gap) {
        let vmax = 1;
        if (pl.lo > 0) vmax = Math.min(vmax, u / pl.lo);
        if (pl.hi > 0) vmax = Math.min(vmax, (pl.L - u) / pl.hi);
        if (vmax > 0.02) lines += cam.seg(pl.P(u, 0), pl.P(u, vmax));
      }
    }
    const width = { tile: 0.9, corrugated: 0.7, rib: 1.2, seam: 1.6, none: 0 }[material];
    const extra: Shape[] = [{ d: lines, stroke: roof.line, width }];
    const r0 = this.rails.length;
    if (opts.panels) extra.push(...this.panels(pl));
    const [a1, b1] = pl.ulim(1);
    if (opts.cap !== false) {
      extra.push({ d: cam.seg(pl.P(a1, 1), pl.P(b1, 1)), stroke: roof.cap, width: 4.6 });
      if (pl.lo > 0) extra.push({ d: cam.seg(pl.P(0, 0), pl.P(a1, 1)), stroke: roof.cap, width: 3.8 });
      if (pl.hi > 0) extra.push({ d: cam.seg(pl.P(pl.L, 0), pl.P(b1, 1)), stroke: roof.cap, width: 3.8 });
    }
    const it = this.face(pl.outline(), fill, extra, true);
    // The power along each row's rail, drawn right after the face it's on.
    if (it)
      for (let i = r0; i < this.rails.length; i++)
        this.items.push({
          layer: it.layer,
          depth: it.depth - 1e-3,
          shapes: [{ d: "", slot: { kind: "rail", d: this.rails[i], i } }],
        });
    if (opts.fascia !== false) {
      // The fascia, and a gutter along it just out and below: drawn after the walls (and the eaves' undersides), so
      // it's in front of them from low down.
      const out = unit([-pl.s[0], -pl.s[1], 0]);
      const g = (u: number) => addk(addk(pl.P(u, 0), out, 0.08), [0, 0, -0.07]);
      const l = this.layer;
      this.layer = 0.9;
      this.add(
        0,
        { d: cam.seg(pl.P(0, 0), pl.P(pl.L, 0)), stroke: FASCIA, width: 3.8 },
        { d: cam.seg(g(0), g(pl.L)), stroke: "#7f878f", width: 6.4, opacity: 0.55 },
        { d: cam.seg(g(0), g(pl.L)), stroke: "#e2e5e8", width: 4.2 },
      );
      this.layer = l;
    }
  }

  /** Portrait panels in rows up a face, centred in each row as far as the face allows, until they're all placed. */
  panels(pl: Plane, rows?: [number, number][]): Shape[] {
    const { cam } = this;
    const span = PANEL_L / pl.len;
    const auto: [number, number][] = [];
    for (let v = 0.12; v + span <= 0.97; v += span + 0.03) auto.push([v, v + span]);
    const lift = 0.06;
    const thick = 0.03;
    let shadows = "";
    let edges = "";
    let frames = "";
    let glass = "";
    let gaps = "";
    for (const [v0, v1] of rows ?? auto) {
      if (this.panelsLeft <= 0) break;
      const a = Math.max(pl.ulim(v0)[0], pl.ulim(v1)[0]) + 0.25;
      const b = Math.min(pl.ulim(v0)[1], pl.ulim(v1)[1]) - 0.25;
      const k = Math.min(Math.floor((b - a + PANEL_GAP) / (PANEL_W + PANEL_GAP)), this.panelsLeft);
      if (k <= 0) continue;
      const start = (a + b) / 2 - (k * PANEL_W + (k - 1) * PANEL_GAP) / 2;
      const dv = 0.012 * (v1 - v0) * 1.4;
      for (let i = 0; i < k; i++) {
        const u0 = start + i * (PANEL_W + PANEL_GAP);
        const u1 = u0 + PANEL_W;
        shadows += cam.poly([
          pl.P(u0, v0 - 0.01, 0.005),
          pl.P(u1, v0 - 0.01, 0.005),
          pl.P(u1, v1 - 0.01, 0.005),
          pl.P(u0, v1 - 0.01, 0.005),
        ]);
        edges += cam.poly([
          pl.P(u0, v0, lift),
          pl.P(u1, v0, lift),
          pl.P(u1, v0, lift - thick),
          pl.P(u0, v0, lift - thick),
        ]);
        frames += cam.poly([pl.P(u0, v0, lift), pl.P(u1, v0, lift), pl.P(u1, v1, lift), pl.P(u0, v1, lift)]);
        glass += cam.poly([
          pl.P(u0 + 0.03, v0 + dv, lift),
          pl.P(u1 - 0.03, v0 + dv, lift),
          pl.P(u1 - 0.03, v1 - dv, lift),
          pl.P(u0 + 0.03, v1 - dv, lift),
        ]);
        for (let c = 1; c < 6; c++) {
          const u = u0 + 0.03 + ((u1 - u0 - 0.06) * c) / 6;
          gaps += cam.seg(pl.P(u, v0 + dv, lift), pl.P(u, v1 - dv, lift));
        }
        for (let r = 1; r < 10; r++) {
          const v = v0 + dv + ((v1 - v0 - 2 * dv) * r) / 10;
          gaps += cam.seg(pl.P(u0 + 0.03, v, lift), pl.P(u1 - 0.03, v, lift));
        }
      }
      this.panelsLeft -= k;
      // The row's top rail, where its power runs: from its far end along to its near one.
      const ra = start - 0.15;
      const rb = start + k * PANEL_W + (k - 1) * PANEL_GAP + 0.15;
      const r = cam.seg(pl.P(rb, v1 + 0.025, lift / 2), pl.P(ra, v1 + 0.025, lift / 2));
      if (r) this.rails.push(r);
    }
    return [
      { d: shadows, fill: "#000000", opacity: 0.25 },
      { d: edges, fill: "#7d8693" },
      { d: frames, fill: "#c3cad4" },
      { d: glass, fill: "url(#lh-glass)", cells: gaps },
      { d: gaps, stroke: "#c9d3e6", width: 0.7, opacity: 0.22 },
    ];
  }

  /**
   * A box's faces that look at the camera, with lines across its walls in their material. The house's own walls
   * (`coursed`) become the items the windows, door and everything else on them are drawn into.
   */
  box(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    front: string,
    side: string,
    top?: string,
    coursed = false,
  ) {
    const faces: [P3[], string, P3][] = [
      [
        [
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        front,
        [0, 1, 0],
      ],
      [
        [
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ],
        side,
        [1, 0, 0],
      ],
      [
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
        side,
        [-1, 0, 0],
      ],
      [
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        front,
        [0, -1, 0],
      ],
    ];
    if (top)
      faces.push([
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        top,
        [0, 0, 1],
      ]);
    for (const [pts, fill, n] of faces) {
      if (!this.facing(mid(pts), n)) continue;
      let lines = "";
      if (coursed && n[2] === 0) {
        const gap = this.walls.material === "brick" ? 0.22 : this.walls.material === "boards" ? 0.28 : 0;
        if (gap)
          for (let z = z0 + gap; z < z1; z += gap)
            lines += this.cam.seg([pts[0][0], pts[0][1], z], [pts[1][0], pts[1][1], z]);
        if (this.walls.material === "battens")
          for (let t = 0.2; t < 1; t += 0.06)
            lines += this.cam.seg(addk(pts[0], sub(pts[1], pts[0]), t), addk(pts[3], sub(pts[2], pts[3]), t));
      }
      const it = this.face(pts, fill, lines ? [{ d: lines, stroke: this.walls.line, width: 0.8 }] : []);
      if (coursed && it && n[2] === 0) {
        const key = n[1] === 1 ? "front" : n[0] === 1 ? "side" : null;
        if (key) this.wallItems[key] = Object.assign(it, { n });
      }
    }
  }

  /**
   * A window on the street side (y fixed) or the right side (x fixed), drawn with its wall: frame, glass, the head's
   * shadow across the top of the glass, the sky caught in it, a sill under it, the mullion; lit at night.
   */
  window(side: "front" | "side", c: number, a0: number, a1: number, z0: number, z1: number) {
    const q = (a: number, z: number, out: number): P3 => (side === "front" ? [a, c + out, z] : [c + out, a, z]);
    const wall = this.wallItems[side];
    const pane = this.cam.poly([q(a0, z0, 0.03), q(a1, z0, 0.03), q(a1, z1, 0.03), q(a0, z1, 0.03)]);
    if (!pane || !wall) return;
    // Where the pane is on the picture (for the light it spills on the wall), and how brightly it's lit: rooms vary.
    const corners = [q(a0, z0, 0.03), q(a1, z0, 0.03), q(a1, z1, 0.03), q(a0, z1, 0.03)].map(this.cam.p);
    let win: Shape["win"];
    if (corners.every(Boolean)) {
      const xs = (corners as P2[]).map((p) => p[0]);
      const ys = (corners as P2[]).map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      win = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, k: [1, 0.82, 0.62][this.windows % 3] };
    }
    this.windows++;
    const sill = [
      q(a0 - 0.2, z0 - 0.12, 0.02),
      q(a1 + 0.2, z0 - 0.12, 0.02),
      q(a1 + 0.2, z0 - 0.12, 0.11),
      q(a0 - 0.2, z0 - 0.12, 0.11),
    ];
    const lip = [
      q(a0 - 0.2, z0 - 0.2, 0.11),
      q(a1 + 0.2, z0 - 0.2, 0.11),
      q(a1 + 0.2, z0 - 0.12, 0.11),
      q(a0 - 0.2, z0 - 0.12, 0.11),
    ];
    const shapes: Shape[] = [
      {
        d: this.cam.poly([
          q(a0 - 0.12, z0 - 0.12, 0.02),
          q(a1 + 0.12, z0 - 0.12, 0.02),
          q(a1 + 0.12, z1 + 0.12, 0.02),
          q(a0 - 0.12, z1 + 0.12, 0.02),
        ]),
        fill: "#f4f1ea",
      },
      { d: pane, fill: "url(#lh-win)", win },
      {
        d: this.cam.poly([q(a0, z1 - 0.17, 0.035), q(a1, z1 - 0.17, 0.035), q(a1, z1, 0.035), q(a0, z1, 0.035)]),
        fill: "#16203a",
        opacity: 0.3,
      },
      {
        d: this.cam.poly([q(a0, z1, 0.036), q(a0 + (a1 - a0) * 0.55, z1, 0.036), q(a0, z0 + (z1 - z0) * 0.2, 0.036)]),
        fill: "#ffffff",
        opacity: 0.16,
      },
      { d: this.cam.poly(lip), fill: this.light("#e6e2d8", lip) },
      { d: this.cam.poly(sill), fill: this.light("#f6f3ec", sill) },
      { d: this.cam.seg(q((a0 + a1) / 2, z0, 0.04), q((a0 + a1) / 2, z1, 0.04)), stroke: "#f4f1ea", width: 2.2 },
    ];
    wall.shapes.push(...shapes.filter((x) => x.d));
  }
}

// ------------------------------------------------------------------------------------------------- the house

/** The lawn, the paths and beds, the walls, and their windows and door. */
function groundAndWalls(B: Builder, g: Geometry) {
  const f = B.walls;
  const { z0, garage } = g;
  const ground = (pts: P3[], fill: string, depth: number) => {
    const d = B.cam.poly(pts);
    if (!d) return;
    B.add(depth, { d, fill: litColour(fill, [0, 0, 1], B.sun) });
  };
  B.layer = -2;
  ground(
    [
      [-500, -500, 0],
      [500, -500, 0],
      [500, 500, 0],
      [-500, 500, 0],
    ],
    "#cdd8bf",
    1e6,
  );
  // A garden bed at the foot of the walls, the front path, and the drive to the garage.
  ground(
    [
      [-0.6, 8, 0.01],
      [10.6, 8, 0.01],
      [10.6, 9.1, 0.01],
      [-0.6, 9.1, 0.01],
    ],
    "#b9c7a6",
    1e5,
  );
  if (!garage)
    ground(
      [
        [10, -0.6, 0.01],
        [11.1, -0.6, 0.01],
        [11.1, 9.1, 0.01],
        [10, 9.1, 0.01],
      ],
      "#b9c7a6",
      1e5,
    );
  else
    ground(
      [
        [garage.x0 + 0.3, garage.y1, 0.012],
        [garage.x1 - 0.2, garage.y1, 0.012],
        [garage.x1 + 0.4, 18, 0.012],
        [garage.x0 - 0.1, 18, 0.012],
      ],
      "#dedbd3",
      1e5,
    );
  ground(
    [
      [4.55, 8, 0.013],
      [5.65, 8, 0.013],
      [5.65, 16, 0.013],
      [4.55, 16, 0.013],
    ],
    "#d9d5cb",
    1e5,
  );
  // The street out the front: the footpath, the kerb, the road and its centre line; and the driveway.
  const strip = (y0: number, y1: number, z: number, fill: string) =>
    ground(
      [
        [-500, y0, z],
        [500, y0, z],
        [500, y1, z],
        [-500, y1, z],
      ],
      fill,
      1e5,
    );
  strip(16, 18, 0.008, "#d3d0c8");
  strip(18, 18.18, 0.007, "#b4b0a7");
  strip(18.18, 26, 0.006, "#5a5d63");
  for (let x = -200; x < 200; x += 9)
    ground(
      [
        [x, 22, 0.009],
        [x + 4.5, 22, 0.009],
        [x + 4.5, 22.14, 0.009],
        [x, 22.14, 0.009],
      ],
      "#d8d6cf",
      1e5,
    );
  if (!garage)
    ground(
      [
        [10.7, 8.2, 0.012],
        [13.75, 8.2, 0.012],
        [13.75, 18, 0.012],
        [10.7, 18, 0.012],
      ],
      "#d6d2c8",
      1e5,
    );
  B.layer = 0;
  if (g.raised) B.box(0.2, 9.8, 0.2, 7.8, 0, z0, "#6b6f74", "#5c6065"); // a Queenslander stands on stumps
  B.box(0, 10, 0, 8, z0, g.eave + 0.1, f.face, f.side, undefined, true);
  // What's on the walls is drawn with them, so it's never sorted behind them.
  const fw = B.wallItems.front;
  const plinth: P3[] = [
    [0, 8.01, z0],
    [10, 8.01, z0],
    [10, 8.01, z0 + 0.35],
    [0, 8.01, z0 + 0.35],
  ];
  if (fw) fw.shapes.push({ d: B.cam.poly(plinth), fill: B.light(f.plinth, plinth) });
  for (let s = 0; s < g.storeys; s++) {
    const b = z0 + s * 2.9;
    B.window("front", 8, 1.2, 3.2, b + 1.0, b + 2.15);
    B.window("front", 8, 6.6, 8.8, b + 1.0, b + 2.15);
    B.window("side", 10, 1.6, 3.6, b + 1.0, b + 2.15);
  }
  if (fw)
    fw.shapes.push(
      {
        d: B.cam.poly([
          [4.6, 8.03, z0],
          [5.6, 8.03, z0],
          [5.6, 8.03, z0 + 2.1],
          [4.6, 8.03, z0 + 2.1],
        ]),
        fill: "#6e5038",
      },
      {
        d: B.cam.poly([
          [4.6, 8.035, z0 + 1.94],
          [5.6, 8.035, z0 + 1.94],
          [5.6, 8.035, z0 + 2.1],
          [4.6, 8.035, z0 + 2.1],
        ]),
        fill: "#16203a",
        opacity: 0.3,
      },
      // The porch light beside the door.
      {
        d: B.cam.poly([
          [5.8, 8.04, z0 + 2.12],
          [5.98, 8.04, z0 + 2.12],
          [5.98, 8.04, z0 + 2.34],
          [5.8, 8.04, z0 + 2.34],
        ]),
        fill: "#3b3f45",
      },
    );
  if (B.night > 0.02) nightLights(B, g);
}

/**
 * At night: the porch light and its glow on the wall around it, and warm light from the windows and the porch falling
 * on the lawn in front of them, softening outwards. Gradients and opacity alone (no blur, for Safari).
 */
function nightLights(B: Builder, g: Geometry) {
  const n = B.night;
  const pool = (pts: P3[], op: number) => {
    const d = B.cam.poly(pts);
    if (d)
      B.items.push({
        layer: -1.5,
        depth: 1e4 - 1,
        shapes: [{ d: "", raw: `<path d="${d}" fill="#ffc874" opacity="${(op * n).toFixed(3)}"/>` }],
      });
  };
  if (!g.raised)
    for (const [a0, a1, k] of [
      [1.2, 3.2, 1],
      [6.6, 8.8, 0.82],
    ])
      for (const [spread, reach, op] of [
        [0.9, 1.9, 0.07],
        [0.45, 1.2, 0.08],
        [0.1, 0.6, 0.1],
      ])
        pool(
          [
            [a0 - spread * 0.3, 8.02, 0.02],
            [a1 + spread * 0.3, 8.02, 0.02],
            [a1 + spread, 8 + reach, 0.02],
            [a0 - spread, 8 + reach, 0.02],
          ],
          op * k,
        );
  for (const [r, op] of [
    [1.6, 0.06],
    [1.0, 0.08],
    [0.55, 0.1],
  ])
    pool(
      Array.from({ length: 14 }, (_, i): P3 => {
        const t = (i / 13) * Math.PI;
        return [5.1 + Math.cos(t) * r * 1.3, 8.02 + Math.sin(t) * r, 0.02];
      }),
      op,
    );
  if (!g.garage && !g.raised)
    for (const [spread, reach, op] of [
      [0.7, 1.5, 0.05],
      [0.3, 0.8, 0.06],
    ])
      pool(
        [
          [10.02, 1.6 - spread * 0.3, 0.02],
          [10.02, 3.6 + spread * 0.3, 0.02],
          [10 + reach, 3.6 + spread, 0.02],
          [10 + reach, 1.6 - spread, 0.02],
        ],
        op * 0.62,
      );
  // The porch light: a bright lamp, and its glow on the wall around it, just after the front wall.
  const fw = B.wallItems.front;
  const at: P3 = [5.89, 8.06, g.z0 + 2.2];
  const lamp = B.cam.p(at);
  if (!fw || !lamp) return;
  const k = B.cam.focal / B.cam.depth(at);
  B.items.push({
    layer: fw.layer,
    depth: fw.depth - 1e-4,
    shapes: [
      {
        d: "",
        raw:
          `<ellipse cx="${n1(lamp[0])}" cy="${n1(lamp[1] + 0.25 * k)}" rx="${n1(1.5 * k)}" ry="${n1(1.3 * k)}" fill="url(#lh-spill)" opacity="${(0.9 * n).toFixed(2)}"/>` +
          `<circle cx="${n1(lamp[0])}" cy="${n1(lamp[1])}" r="${n1(Math.max(1.5, 0.07 * k))}" fill="#fff4d6" opacity="${n.toFixed(2)}"/>`,
      },
    ],
  });
}

function gable(B: Builder, eave: number, rise: number, material: Material, oh = 0.45) {
  const { roof, walls: f } = B;
  const front = new Plane([-oh, 8 + oh, eave], [1, 0, 0], 10 + 2 * oh, [0, -(4 + oh), rise]);
  const back = new Plane([10 + oh, -oh, eave], [-1, 0, 0], 10 + 2 * oh, [0, 4 + oh, rise]);
  for (const [x, nx] of [
    [0, -1],
    [10, 1],
  ] as const)
    if ((B.cam.eye[0] - x) * nx > 0)
      B.face(
        [
          [x, 0, eave + 0.1],
          [x, 8, eave + 0.1],
          [x, 4, eave + (rise * 4) / (4 + oh) + 0.1],
        ],
        nx > 0 ? f.side : f.face,
      );
  B.roofFace(back, roof.back, material);
  B.roofFace(front, roof.face, material, { panels: true });
  for (const x of [-oh, 10 + oh])
    B.add(B.depthOf([[x, 6, eave + rise / 2]]) - 0.5, {
      d: B.cam.seg([x, 8 + oh, eave], [x, 4, eave + rise]),
      stroke: FASCIA,
      width: 3.8,
    });
}

function hip(B: Builder, eave: number, rise: number, material: Material, oh = 0.5) {
  const { roof } = B;
  const d = 4 + oh;
  const L = 10 + 2 * oh;
  B.roofFace(new Plane([10 + oh, -oh, eave], [-1, 0, 0], L, [0, d, rise], d, d), roof.back, material);
  B.roofFace(new Plane([-oh, -oh, eave], [0, 1, 0], 8 + 2 * oh, [d, 0, rise], d, d), roof.side, material);
  // The street face takes the panels first; what doesn't fit there goes on the end facing you (as installers do).
  B.roofFace(new Plane([-oh, 8 + oh, eave], [1, 0, 0], L, [0, -d, rise], d, d), roof.face, material, { panels: true });
  B.roofFace(new Plane([10 + oh, 8 + oh, eave], [0, -1, 0], 8 + 2 * oh, [-d, 0, rise], d, d), roof.side, material, {
    panels: true,
  });
}

function skillion(B: Builder, eave: number, rise: number, material: Material, firewall = false, oh = 0.45) {
  const { roof, walls: f } = B;
  const pl = new Plane([-oh, 8 + oh, eave], [1, 0, 0], 10 + 2 * oh, [0, -(8 + 2 * oh), rise]);
  const z = (y: number) => eave + (rise * (8 + oh - y)) / (8 + 2 * oh);
  B.face(
    [
      [10, 0, eave],
      [10, 8, eave],
      [10, 8, z(8)],
      [10, 0, z(0)],
    ],
    f.side,
  );
  B.face(
    [
      [0, 0, eave],
      [0, 8, eave],
      [0, 8, z(8)],
      [0, 0, z(0)],
    ],
    f.face,
  );
  B.roofFace(pl, roof.face, material, { panels: true, cap: false });
  if (firewall) B.box(-0.35, 0, -0.5, 8.6, eave, z(-0.5) + 0.35, f.face, f.side, f.side);
}

function flat(B: Builder, eave: number) {
  const { roof } = B;
  B.box(-0.3, 10.3, -0.3, 8.6, eave, eave + 0.35, FASCIA, "#e3dfd6", roof.face);
  for (const x of [-0.3, 10.3]) for (const y of [-0.3, 8.6]) B.roofPts.push([x, y, eave + 0.35]);
  // The panels on tilted frames, in rows facing the street.
  const tilt = (12 * Math.PI) / 180;
  for (const yb of [6.6, 4.4, 2.2]) {
    if (B.panelsLeft <= 0) break;
    const k = Math.min(8, B.panelsLeft);
    const x0 = 5 - (k * PANEL_W + (k - 1) * PANEL_GAP) / 2;
    const base = eave + 0.45;
    const pl = new Plane([x0 - 0.15, yb, base], [1, 0, 0], k * PANEL_W + (k - 1) * PANEL_GAP + 0.3, [
      0,
      -PANEL_L * Math.cos(tilt),
      PANEL_L * Math.sin(tilt),
    ]);
    let legs = "";
    for (let i = 0; i < k; i++) {
      const x = x0 + i * (PANEL_W + PANEL_GAP) + 0.1;
      legs += B.cam.seg(
        [x, yb - PANEL_L * Math.cos(tilt) + 0.1, eave + 0.36],
        [x, yb - PANEL_L * Math.cos(tilt) + 0.1, base + PANEL_L * Math.sin(tilt) - 0.05],
      );
    }
    const shapes = B.panels(pl, [[0, 0.98]]);
    B.add(B.depthOf(pl.outline()), { d: legs, stroke: "#9aa1aa", width: 2.1 }, ...shapes);
  }
}

function verandah(B: Builder, eave: number) {
  const pl = new Plane([-0.6, 10.6, eave - 0.55], [1, 0, 0], 11.2, [0, -2.4, 0.5]);
  B.roofFace(pl, B.roof.face, "corrugated", { cap: false });
  for (const x of [-0.4, 2.5, 5, 7.5, 10.4])
    B.add(B.depthOf([[x, 10.5, 1]]), {
      d: B.cam.seg([x, 10.5, 0], [x, 10.5, eave - 0.55]),
      stroke: "#ffffff",
      width: 3.3,
    });
}

function chimney(B: Builder, x: number, y: number, base: number, top: number) {
  B.box(x, x + 0.7, y, y + 0.7, base, top, "#b5553f", "#9a4533", "#7a3a2c");
  for (const px of [x + 0.18, x + 0.5])
    B.box(px - 0.1, px + 0.1, y + 0.25, y + 0.45, top, top + 0.35, "#c8643f", "#a9502f", "#6b2a1a");
}

/** The roof each style has, as the Overview draws it. */
const ROOFS_OF: Record<HouseStyle, (B: Builder, eave: number) => void> = {
  estate: (B, e) => gable(B, e, 1.9, "tile"),
  brick: (B, e) => hip(B, e, 1.8, "tile"),
  modern: (B, e) => flat(B, e),
  coastal: (B, e) => skillion(B, e, 1.5, "rib"),
  queenslander: (B, e) => {
    hip(B, e, 2.3, "corrugated");
    verandah(B, e);
  },
  federation: (B, e) => {
    hip(B, e, 2.0, "tile");
    chimney(B, 7.4, 2.4, e - 0.6, e + 3.0);
  },
  bungalow: (B, e) => {
    const oh = 0.5;
    const { roof } = B;
    B.roofFace(new Plane([-oh, -oh, e], [0, 1, 0], 8 + 2 * oh, [5 + oh, 0, 1.7]), roof.side, "tile");
    B.roofFace(new Plane([10 + oh, 8 + oh, e], [0, -1, 0], 8 + 2 * oh, [-(5 + oh), 0, 1.7]), roof.face, "tile", {
      panels: true,
    });
    let battens = "";
    for (const x of [3, 4, 5, 6, 7])
      battens += B.cam.seg(
        [x, 8 + oh + 0.01, e + 0.05],
        [x, 8 + oh + 0.01, e + 1.7 * (1 - Math.abs(x - 5) / (5 + oh)) - 0.05],
      );
    B.face(
      [
        [-oh, 8 + oh, e],
        [10 + oh, 8 + oh, e],
        [5, 8 + oh, e + 1.7],
      ],
      "#e8dcc8",
      [{ d: battens, stroke: "#6e5038", width: 2.4 }],
    );
  },
  farmhouse: (B, e) => gable(B, e, 3.4, "seam", 0.3),
  townhouse: (B, e) => skillion(B, e, 1.3, "rib", true),
};

// ------------------------------------------------------------------------------------------------- the garage

/** Inside the garage, its door rolled up: the floor, the walls and the ceiling, lit from inside at night. */
function garageInside(B: Builder, g: Garage) {
  B.layer = 2;
  const ix0 = g.x0 + g.t;
  const ix1 = g.x1 - g.t;
  const iy0 = g.y0 + g.t;
  const top = g.h - 0.14;
  const inner = (pts: P3[], fill: string, n: P3) => {
    if (B.facing(mid(pts), n)) B.face(pts, fill, [], false, true);
  };
  inner(
    [
      [ix0, iy0, 0.005],
      [ix1, iy0, 0.005],
      [ix1, g.y1, 0.005],
      [ix0, g.y1, 0.005],
    ],
    "#a9a69f",
    [0, 0, 1],
  );
  inner(
    [
      [ix0, iy0, 0],
      [ix1, iy0, 0],
      [ix1, iy0, top],
      [ix0, iy0, top],
    ],
    "#d8d2c6",
    [0, 1, 0],
  );
  inner(
    [
      [ix0, iy0, 0],
      [ix0, g.y1, 0],
      [ix0, g.y1, top],
      [ix0, iy0, top],
    ],
    "#c4bdb0",
    [1, 0, 0],
  );
  inner(
    [
      [ix1, iy0, 0],
      [ix1, g.y1, 0],
      [ix1, g.y1, top],
      [ix1, iy0, top],
    ],
    "#c4bdb0",
    [-1, 0, 0],
  );
  inner(
    [
      [ix0, iy0, top],
      [ix1, iy0, top],
      [ix1, g.y1, top],
      [ix0, g.y1, top],
    ],
    "#b3ada2",
    [0, 0, -1],
  );
  // The roller door, rolled up under the lintel.
  B.layer = 3.5;
  B.face(
    [
      [g.dx0, g.y1 - g.t - 0.22, g.dz + 0.06],
      [g.dx1, g.y1 - g.t - 0.22, g.dz + 0.06],
      [g.dx1, g.y1 - g.t, g.dz + 0.06],
      [g.dx0, g.y1 - g.t, g.dz + 0.06],
    ],
    "#8f8c86",
    [],
    false,
    true,
  );
}

/** The garage's walls round its open door, and its roof. */
function garageShell(B: Builder, g: Garage) {
  B.layer = 4;
  const f = B.walls;
  const ext = (pts: P3[], fill: string, n: P3, lines = "") => {
    if (B.facing(mid(pts), n)) B.face(pts, fill, lines ? [{ d: lines, stroke: f.line, width: 0.8 }] : []);
  };
  const course = (xa: number, xb: number, y: number, za: number, zb: number) => {
    const gap = f.material === "brick" ? 0.22 : f.material === "boards" ? 0.28 : 0;
    let s = "";
    if (gap) for (let z = za + gap; z < zb; z += gap) s += B.cam.seg([xa, y, z], [xb, y, z]);
    return s;
  };
  const { x0, x1, y0, y1, h, t, dx0, dx1, dz } = g;
  ext(
    [
      [x0, y1, 0],
      [dx0, y1, 0],
      [dx0, y1, h],
      [x0, y1, h],
    ],
    f.face,
    [0, 1, 0],
    course(x0, dx0, y1, 0, h),
  );
  ext(
    [
      [dx1, y1, 0],
      [x1, y1, 0],
      [x1, y1, h],
      [dx1, y1, h],
    ],
    f.face,
    [0, 1, 0],
    course(dx1, x1, y1, 0, h),
  );
  ext(
    [
      [dx0, y1, dz],
      [dx1, y1, dz],
      [dx1, y1, h],
      [dx0, y1, h],
    ],
    f.face,
    [0, 1, 0],
    course(dx0, dx1, y1, dz, h),
  );
  ext(
    [
      [dx0, y1 - t, 0],
      [dx0, y1, 0],
      [dx0, y1, dz],
      [dx0, y1 - t, dz],
    ],
    f.side,
    [1, 0, 0],
  );
  ext(
    [
      [dx1, y1 - t, 0],
      [dx1, y1, 0],
      [dx1, y1, dz],
      [dx1, y1 - t, dz],
    ],
    f.side,
    [-1, 0, 0],
  );
  ext(
    [
      [dx0, y1 - t, dz],
      [dx1, y1 - t, dz],
      [dx1, y1, dz],
      [dx0, y1, dz],
    ],
    f.side,
    [0, 0, -1],
  );
  const side: P3[] = [
    [x1, y0, 0],
    [x1, y1, 0],
    [x1, y1, h],
    [x1, y0, h],
  ];
  if (B.facing(mid(side), [1, 0, 0])) {
    // Its lines run along it, and the battery may hang on it.
    let lines = "";
    const gap = f.material === "brick" ? 0.22 : f.material === "boards" ? 0.28 : 0;
    if (gap) for (let z = gap; z < h; z += gap) lines += B.cam.seg([x1, y0, z], [x1, y1, z]);
    const it = B.face(side, f.side, lines ? [{ d: lines, stroke: f.line, width: 0.8 }] : []);
    if (it) B.garageSide = Object.assign(it, { n: [1, 0, 0] as P3 });
  }
  roofSlab(B, g);
}

/** A carport: posts at its outer corners under a flat roof of sheeting. */
function carport(B: Builder, g: Garage) {
  B.layer = 4;
  for (const y of [g.y0 + 0.2, g.y1 + 0.05])
    B.box(g.x1 - 0.25, g.x1 - 0.13, y - 0.06, y + 0.06, 0, g.h, "#ecebe6", "#d9d7d0");
  roofSlab(B, g);
}

function roofSlab(B: Builder, g: Garage) {
  const r = B.roof;
  const top: P3[] = [
    [g.x0, g.y0, g.h],
    [g.x1, g.y0, g.h],
    [g.x1, g.y1 + 0.25, g.h],
    [g.x0, g.y1 + 0.25, g.h],
  ];
  B.roofPts.push(...top);
  if (B.facing(mid(top), [0, 0, 1])) B.face(top, r.face);
  B.add(B.depthOf([top[2], top[3]]) - 0.2, { d: B.cam.seg(top[3], top[2]), stroke: FASCIA, width: 3.8 });
}

// ------------------------------------------------------------------------------------------------- the battery and inverter

/** The kit's layer: inside the garage between its walls and its shell, else in front of the wall it's on. */
const kitLayer = (M: Mount) => (M.inside ? 3 : M.o[0] === 10 ? 1 : 4.6);

/** The kit's colours, each side and top back to its front's own before it's lit. */
const KIT_BASE: [string, string][] = [
  ["#cfd4da", "#eef0f2"],
  ["#f7f8f9", "#eef0f2"],
  ["#d3d8de", "#f3f4f5"],
  ["#fafafa", "#f3f4f5"],
  ["#4b5058", "#5b616a"],
  ["#6b717a", "#5b616a"],
];

/**
 * The battery (a stack of modules on a plinth with a control unit on top, as Sungrow's SBR is), the inverter beside it
 * and the conduit from the eave down to it and across to the battery, on their wall. Without a battery, the inverter
 * alone.
 */
function kit(
  B: Builder,
  M: Mount,
  battery: boolean,
): Kit & { q: (u: number, o: number, z: number) => P3; boxes: number[][] } {
  const q = (u: number, o: number, z: number): P3 => addk(addk(addk(M.o, M.a, u), M.n, o), [0, 0, z]);
  // On a wall that faces away from the camera it's behind that wall: none of it shows.
  if (!B.facing(q(0.8, 0, 1.0), M.n)) {
    const none = { track: "", fill: "", up: "", led: "", status: "" };
    return { q, boxes: [], shown: false, battery, dc: "", link: "", bar: () => none };
  }
  B.layer = kitLayer(M);
  const wbox = (
    u0: number,
    u1: number,
    o0: number,
    o1: number,
    z0: number,
    z1: number,
    front: string,
    side: string,
    top: string,
    extra: Shape[] = [],
  ) => {
    const faces: [P3[], string, P3, Shape[]][] = [
      [[q(u0, o1, z0), q(u1, o1, z0), q(u1, o1, z1), q(u0, o1, z1)], front, M.n, extra],
      [[q(u1, o0, z0), q(u1, o1, z0), q(u1, o1, z1), q(u1, o0, z1)], side, M.a, []],
      [[q(u0, o0, z0), q(u0, o1, z0), q(u0, o1, z1), q(u0, o0, z1)], side, neg(M.a), []],
      [[q(u0, o0, z1), q(u1, o0, z1), q(u1, o1, z1), q(u0, o1, z1)], top, [0, 0, 1], []],
    ];
    for (const [pts, fill, n, ex] of faces) if (B.facing(mid(pts), n)) B.face(pts, fill, ex);
  };
  const bu0 = 0;
  const bu1 = 0.66;
  const bo = 0.26;
  const bz1 = 1.7;
  if (battery) {
    let seams = "";
    for (const z of [0.27, 0.6, 0.93, 1.26, 1.5]) {
      seams += B.cam.seg(q(bu0, bo + 0.003, z), q(bu1, bo + 0.003, z));
      seams += B.cam.seg(q(bu1 + 0.003, 0, z), q(bu1 + 0.003, bo, z));
    }
    wbox(bu0, bu1, 0, bo, 0.1, bz1, "#eef0f2", "#cfd4da", "#f7f8f9", [{ d: seams, stroke: "#9aa3ad", width: 1.1 }]);
    wbox(bu0 + 0.02, bu1 - 0.02, 0.02, bo - 0.02, 0, 0.1, "#5b616a", "#4b5058", "#6b717a");
  }
  const iu0 = 1.05;
  const iu1 = 1.6;
  const iz0 = 1.02;
  const iz1 = 1.66;
  const screen = B.cam.poly([
    q(iu0 + 0.13, 0.205, iz1 - 0.24),
    q(iu1 - 0.13, 0.205, iz1 - 0.24),
    q(iu1 - 0.13, 0.205, iz1 - 0.11),
    q(iu0 + 0.13, 0.205, iz1 - 0.11),
  ]);
  wbox(iu0, iu1, 0, 0.2, iz0, iz1, "#f3f4f5", "#d3d8de", "#fafafa", [{ d: screen, fill: "#1f2833" }]);
  const pipe = (pts: P3[]) =>
    B.add(
      -1e4,
      { d: B.cam.line(pts), stroke: "#aab1ba", width: 4.4 },
      { d: B.cam.line(pts), stroke: "#d6dbe1", width: 2 },
    );
  const dc = [q(1.42, 0.05, M.top), q(1.42, 0.05, iz1)];
  const link = [q(1.15, 0.05, iz0), q(1.15, 0.05, 0.72), q(bu1, 0.05, 0.72)];
  pipe(dc);
  if (battery) pipe(link);
  // Its level, lights and power, drawn right after it.
  B.items.push({ layer: B.layer, depth: -1e5, shapes: [{ d: "", slot: { kind: "kit" } }] });
  B.layer = 0;
  const um = (bu0 + bu1) / 2;
  const w = 0.035;
  return {
    q,
    boxes: battery
      ? [
          [bu0, bu1, 0, bo, 0, bz1],
          [iu0, iu1, 0, 0.2, iz0, iz1],
        ]
      : [[iu0, iu1, 0, 0.2, iz0, iz1]],
    shown: true,
    battery,
    dc: B.cam.line(dc),
    link: battery ? B.cam.line(link) : "",
    // The level shows on the battery's face as a column of light, filling from the bottom.
    bar: (level: number) => {
      const z0 = 0.34;
      const z1 = 1.42;
      const zt = z0 + (z1 - z0) * clamp01(level);
      return {
        track: B.cam.poly([
          q(um - w, bo + 0.006, z0),
          q(um + w, bo + 0.006, z0),
          q(um + w, bo + 0.006, z1),
          q(um - w, bo + 0.006, z1),
        ]),
        fill: B.cam.poly([
          q(um - w, bo + 0.008, z0),
          q(um + w, bo + 0.008, z0),
          q(um + w, bo + 0.008, zt),
          q(um - w, bo + 0.008, zt),
        ]),
        up: B.cam.line([q(um, bo + 0.01, z0), q(um, bo + 0.01, Math.max(zt, z0 + 0.05))]),
        led: B.cam.poly([
          q(um - 0.07, bo + 0.006, 1.57),
          q(um + 0.07, bo + 0.006, 1.57),
          q(um + 0.07, bo + 0.006, 1.6),
          q(um - 0.07, bo + 0.006, 1.6),
        ]),
        status: B.cam.poly([
          q(iu1 - 0.12, 0.205, iz0 + 0.1),
          q(iu1 - 0.08, 0.205, iz0 + 0.1),
          q(iu1 - 0.08, 0.205, iz0 + 0.14),
          q(iu1 - 0.12, 0.205, iz0 + 0.14),
        ]),
      };
    },
  };
}

// ------------------------------------------------------------------------------------------------- the car and the street

/** A box on a wall's frame, lit like everything else; the points of the frame, for what's on its front. */
function boxOn(
  B: Builder,
  F: Frame,
  u0: number,
  u1: number,
  o0: number,
  o1: number,
  z0: number,
  z1: number,
  front: string,
  side: string,
  top: string,
  extra: Shape[] = [],
) {
  const q = (u: number, o: number, z: number): P3 => addk(addk(addk(F.o, F.a, u), F.n, o), [0, 0, z]);
  const faces: [P3[], string, P3, Shape[]][] = [
    [[q(u0, o1, z0), q(u1, o1, z0), q(u1, o1, z1), q(u0, o1, z1)], front, F.n, extra],
    [[q(u1, o0, z0), q(u1, o1, z0), q(u1, o1, z1), q(u1, o0, z1)], side, F.a, []],
    [[q(u0, o0, z0), q(u0, o1, z0), q(u0, o1, z1), q(u0, o0, z1)], side, neg(F.a), []],
    [[q(u0, o0, z1), q(u1, o0, z1), q(u1, o1, z1), q(u0, o1, z1)], top, [0, 0, 1], []],
  ];
  for (const [pts, fill, n, ex] of faces) if (B.facing(mid(pts), n)) B.face(pts, fill, ex);
  return q;
}

/** A round post or rod from `a` to `b`, tapering, its sunny side lighter. */
function rod(B: Builder, a: P3, b: P3, w0: number, w1: number, col: string): Shape[] {
  const c = B.cam;
  const pa = c.p(a);
  const pb = c.p(b);
  if (!pa || !pb) return [];
  const ka = c.focal / c.depth(a);
  const kb = c.focal / c.depth(b);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const m = Math.hypot(dx, dy) || 1;
  const nx = -dy / m;
  const ny = dx / m;
  const sp = c.p(addk(b, B.sun.dir, 1));
  const sx = sp ? sp[0] - pb[0] : -1;
  const sy = sp ? sp[1] - pb[1] : 0;
  const side = nx * sx + ny * sy >= 0 ? 1 : -1;
  const half = (f: number) =>
    `M${n1(pa[0] + nx * w0 * ka * f)} ${n1(pa[1] + ny * w0 * ka * f)} L${n1(pb[0] + nx * w1 * kb * f)} ${n1(pb[1] + ny * w1 * kb * f)} L${n1(pb[0])} ${n1(pb[1])} L${n1(pa[0])} ${n1(pa[1])} Z`;
  return [
    { d: half(side), fill: css(mix(rgb(col), [255, 250, 236], 0.22 * B.sun.L)) },
    { d: half(-side), fill: css(rgb(col).map((v) => v * 0.72) as Rgb) },
  ];
}

/** A wire hanging between two points. */
const sag = (a: P3, b: P3, s: number, n = 10): P3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return addk(lerp3(a, b, t), [0, 0, -4 * s * t * (1 - t)]);
  });

/*
 * The car, a 2022 Model Y, drawn from Tesla's own side and plan drawings and its numbers: 4.751 m long, 2.89 between
 * its axles, 1.624 high and 1.921 wide. Its body is cross-sections along it, from its rear bumper (u, metres) to its
 * nose, each made from the curves below: its underside (zb), how wide it is at its widest (hw, its plan) and how high
 * that is (zh), its belt line (zbelt) and roof rail (zr) and how far in each leans (fb, fr, parts of hw), and its top
 * along the middle (zt, its side-on outline). Each runs up from the sill round its hips, over a rounded shoulder to the
 * belt line, up the glass to the rail, then across the roof (or the bonnet, or the tailgate's lip) to the middle.
 */
type Curve = (u: number) => number;
/** Numbers two at a time, as points. */
const pairs = (xs: number[]): P2[] => Array.from({ length: xs.length / 2 }, (_, i) => [xs[2 * i], xs[2 * i + 1]]);
/** A smooth curve through points (u, value, u, value...) that never overshoots them (a monotone cubic). */
function curve(flat: number[]): Curve {
  const keys = pairs(flat);
  const n = keys.length;
  const h = keys.slice(1).map(([u], i) => u - keys[i][0]);
  const d = keys.slice(1).map(([, v], i) => (v - keys[i][1]) / h[i]);
  const m = keys.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    if (d[i - 1] * d[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  });
  return (u) => {
    if (u <= keys[0][0]) return keys[0][1];
    if (u >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (keys[i + 1][0] < u) i++;
    const t = (u - keys[i][0]) / h[i];
    const [a, b] = [keys[i][1], keys[i + 1][1]];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * b + (t3 - t2) * h[i] * m[i + 1]
    );
  };
}
const CAR = {
  zb: curve([
    0, 0.47, 0.015, 0.41, 0.035, 0.375, 0.07, 0.345, 0.13, 0.31, 0.3, 0.27, 0.5, 0.235, 0.62, 0.22, 1.45, 0.185, 3.35,
    0.185, 4.2, 0.205, 4.45, 0.215, 4.55, 0.225, 4.62, 0.26, 4.67, 0.31, 4.705, 0.38, 4.73, 0.46, 4.745, 0.53, 4.751,
    0.6,
  ]),
  zt: curve([
    0, 0.8, 0.015, 0.95, 0.035, 1.12, 0.052, 1.225, 0.065, 1.25, 0.1, 1.245, 0.16, 1.247, 0.28, 1.285, 0.44, 1.335,
    0.61, 1.385, 0.77, 1.433, 0.94, 1.473, 1.09, 1.511, 1.24, 1.542, 1.39, 1.571, 1.54, 1.593, 1.69, 1.611, 1.87, 1.621,
    2.0, 1.624, 2.13, 1.621, 2.28, 1.608, 2.43, 1.59, 2.58, 1.558, 2.73, 1.514, 2.88, 1.461, 3.02, 1.398, 3.17, 1.325,
    3.32, 1.238, 3.47, 1.144, 3.56, 1.105, 3.66, 1.097, 3.77, 1.078, 3.92, 1.039, 4.09, 0.996, 4.25, 0.945, 4.42, 0.882,
    4.52, 0.84, 4.6, 0.8, 4.65, 0.775, 4.69, 0.75, 4.718, 0.727, 4.737, 0.703, 4.751, 0.67,
  ]),
  hw: curve([
    0, 0.12, 0.1, 0.43, 0.18, 0.65, 0.27, 0.762, 0.35, 0.826, 0.44, 0.864, 0.53, 0.893, 0.61, 0.916, 0.7, 0.936, 0.78,
    0.946, 0.87, 0.954, 1.0, 0.961, 1.19, 0.957, 1.35, 0.948, 1.5, 0.929, 1.66, 0.916, 1.89, 0.913, 2.2, 0.907, 2.5,
    0.904, 2.9, 0.916, 3.36, 0.936, 3.6, 0.951, 3.9, 0.961, 4.16, 0.951, 4.25, 0.945, 4.33, 0.925, 4.42, 0.884, 4.51,
    0.797, 4.59, 0.666, 4.68, 0.5, 4.72, 0.4, 4.74, 0.32, 4.751, 0.18,
  ]),
  zh: curve([
    0, 0.62, 0.05, 0.7, 0.18, 0.84, 0.45, 0.9, 0.98, 0.9, 1.45, 0.8, 2.2, 0.7, 3.2, 0.7, 3.87, 0.72, 4.4, 0.68, 4.6,
    0.65, 4.7, 0.64, 4.751, 0.63,
  ]),
  zbelt: curve([
    0, 0.71, 0.015, 0.86, 0.035, 1.03, 0.052, 1.17, 0.07, 1.205, 0.16, 1.21, 0.5, 1.2, 0.88, 1.19, 1.14, 1.188, 2.2,
    1.124, 3.26, 1.068, 3.45, 1.05, 3.6, 1.045, 3.9, 1.0, 4.2, 0.925, 4.42, 0.855, 4.58, 0.79, 4.66, 0.755, 4.71, 0.725,
    4.74, 0.7, 4.751, 0.688,
  ]),
  zr: curve([
    0, 0.76, 0.015, 0.9, 0.035, 1.075, 0.052, 1.2, 0.07, 1.232, 0.16, 1.236, 0.3, 1.258, 0.6, 1.3, 0.871, 1.342, 1.082,
    1.407, 1.33, 1.47, 1.64, 1.527, 1.949, 1.548, 2.197, 1.545, 2.383, 1.523, 2.631, 1.46, 2.879, 1.351, 3.095, 1.21,
    3.26, 1.09, 3.42, 1.07, 3.6, 1.065, 3.9, 1.02, 4.2, 0.945, 4.42, 0.872, 4.58, 0.805, 4.66, 0.77, 4.71, 0.74, 4.74,
    0.715, 4.751, 0.7,
  ]),
  fb: curve([0, 0.9, 0.1, 0.9, 0.4, 0.86, 0.8, 0.82, 1.05, 0.815, 1.4, 0.85, 1.8, 0.89, 2.4, 0.9, 4.751, 0.9]),
  round: curve([0, 0.6, 0.06, 0.45, 0.2, 0.22, 0.45, 0, 4.1, 0, 4.35, 0.12, 4.55, 0.35, 4.68, 0.62, 4.751, 1]),
  fr: curve([
    0, 0.86, 0.1, 0.84, 0.3, 0.75, 0.6, 0.7, 1.0, 0.69, 1.4, 0.72, 2.0, 0.77, 2.3, 0.78, 2.7, 0.8, 3.1, 0.83, 3.4, 0.86,
    3.6, 0.87, 4.751, 0.87,
  ]),
};
/** Where its wheels are along it, their tyres' radius (255/45 R19), their arches' and their outer faces' (m). */
const AXLES = [0.98, 3.87];
const TYRE = 0.356;
const ARCH = 0.44;
const WHEEL_W = 0.93;
const GLASS = "#161d26";
const ROOF_GLASS = "#1c2531";
const TRIM = "#131518";
const BLACK = "#1b1d21";
const WELL = "#0d0e10";
const PAINT = "paint";
/** What stays dark whatever the light: it only catches a little of the sky. */
const LAMP = "#1a1f27";
const DARK = new Set([GLASS, ROOF_GLASS, TRIM, BLACK, WELL, LAMP]);

/**
 * Its side at `u`, [out from the middle, up], from the sill up: the sill and its rounded foot, the hips (its widest),
 * the shoulder rolling in to the belt line (point 7), the glass leaning in to the roof rail (10), then the roof (or the
 * bonnet, or the lip) rounding over towards the middle.
 */
function carSide(u: number): P2[] {
  const hw = CAR.hw(u);
  const zb = CAR.zb(u);
  const zt = CAR.zt(u);
  const zr = Math.min(CAR.zr(u), zt - 0.008);
  const zbelt = Math.min(CAR.zbelt(u), zr - 0.012);
  const zh = Math.min(CAR.zh(u), zbelt - 0.06);
  const wb = hw * CAR.fb(u);
  const wr = hw * Math.min(CAR.fr(u), CAR.fb(u) - 0.02);
  const pts: P2[] = [
    [0.84 * hw, zb],
    [0.94 * hw, zb + Math.min(0.045, 0.3 * (zh - zb))],
    [0.985 * hw, zb + 0.45 * (zh - zb)],
    [hw, zh],
  ];
  // The shoulder: straight up from the hips, then rolling in to the belt line.
  const cz = zh + 0.7 * (zbelt - zh);
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const s = 1 - t;
    pts.push([s * s * hw + 2 * s * t * hw + t * t * wb, s * s * zh + 2 * s * t * cz + t * t * zbelt]);
  }
  // The glass, bowed out a little.
  for (const t of [1 / 3, 2 / 3, 1])
    pts.push([lerp(wb, wr, t) + 0.05 * (wb - wr) * Math.sin(Math.PI * t), lerp(zbelt, zr, t)]);
  // Over the top: a quarter of a rounded square, from the rail to the middle.
  for (const deg of [16, 34, 52, 71]) {
    const a = (deg * Math.PI) / 180;
    pts.push([wr * Math.pow(Math.cos(a), 0.8), zr + (zt - zr) * Math.pow(Math.sin(a), 0.8)]);
  }
  // Towards its nose and tail, each section rounds into a full oval about its widest, so both ends are smooth and
  // bulge most around the height of the lights.
  const e = CAR.round(u);
  if (e <= 0) return pts;
  return pts.map(([w, z], i): P2 => {
    const a = (OVAL[i] * Math.PI) / 180;
    const ow = hw * Math.pow(Math.cos(a), 0.75);
    const oz = zh + (a < 0 ? zh - zb : zt - zh) * Math.sin(a);
    return [lerp(w, ow, e), lerp(z, oz, e)];
  });
}
/** Where each of a section's points sits round its oval (degrees up from its widest). */
const OVAL = [-80, -66, -40, 0, 16, 30, 43, 53, 61, 68, 74, 79, 83, 86, 88.5];
const SIDE_N = 15;
/** How far out its surface is at `u` and height `z` (from the sill over the top), or -1 off it. */
function carWidth(u: number, z: number): number {
  const pts = [...carSide(u), [0, CAR.zt(u)] as P2];
  if (z < pts[0][1] || z > pts[pts.length - 1][1]) return -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const [w0, z0] = pts[i];
    const [w1, z1] = pts[i + 1];
    if (z <= z1) return z1 > z0 ? lerp(w0, w1, (z - z0) / (z1 - z0)) : w1;
  }
  return 0;
}
/** A point on its side (out from the middle `w`, along it `u`, up `z`), a little proud of it. */
const carAt = (u: number, z: number, sg: number, out = 0.004): P3 => [sg * (carWidth(u, z) + out), u, z];
/** A point on its tail (or nose) at `w` across and `z` up: the first of its cross-sections there. */
function carEnd(w: number, z: number, nose: boolean): P3 {
  let lo = nose ? 3.9 : 0;
  let hi = nose ? CAR_L : 1.2;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const inside = carWidth(m, z) >= Math.abs(w);
    if (inside === nose) lo = m;
    else hi = m;
  }
  return [w, nose ? lo + 0.004 : hi - 0.004, z];
}

/*
 * What's painted on its body, each as an outline flat in one of four views of it: side-on (along it, up), from above
 * (along it, out from the middle), and wrapped round its tail or its nose (out from the middle plus how far round the
 * corner, up), on the parts of its sections it belongs to: low (sill to belt line), the glass's (belt to rail) or the
 * top. Each face of the body is cut by them, so they keep their shape across the faces without ever leaving them.
 */
type View = "side" | "plan" | "tail" | "nose";
const LOW = 1;
const SIDES = 2;
const TOP = 4;
type Decal = { view: View; on: number; fill: string; pts: P2[]; sg?: number };
const ring = (cu: number, cz: number, r0: number, r1: number, from: number, to: number, n = 18): P2[] => {
  const arc = (r: number) =>
    Array.from({ length: n + 1 }, (_, i): P2 => {
      const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      return [cu + r * Math.cos(a), cz + r * Math.sin(a)];
    });
  return r0 > 0 ? [...arc(r1), ...arc(r0).reverse()] : arc(r1);
};
const DECALS: Decal[] = [
  // Its side windows, black-framed, back to the rear quarter window's point; the pillars between them gloss black.
  {
    view: "side",
    on: SIDES,
    fill: GLASS,
    pts: pairs([
      3.43,
      0.9,
      3.43,
      2,
      0.875,
      2,
      0.875,
      CAR.zr(0.875) - 0.012,
      0.96,
      1.293,
      1.06,
      1.25,
      1.17,
      1.196,
      1.18,
      0.9,
    ]),
  },
  {
    view: "side",
    on: SIDES,
    fill: TRIM,
    pts: pairs([2.1, 1, 2.22, 1, 2.11, 1.7, 1.99, 1.7]),
  },
  {
    view: "side",
    on: SIDES,
    fill: TRIM,
    pts: pairs([1.165, 1, 1.2, 1, 1.205, 1.7, 1.17, 1.7]),
  },
  // Its windscreen and glass roof, the rear glass narrower between painted pillars, down to the tailgate's lip.
  {
    view: "plan",
    on: TOP,
    fill: GLASS,
    pts: pairs([3.565, 0, 3.55, 0.3, 3.51, 0.5, 3.45, 0.68, 3.39, 0.9, 2.31, 0.9, 2.27, 0.45, 2.25, 0]),
  },
  {
    view: "plan",
    on: TOP,
    fill: ROOF_GLASS,
    pts: pairs([2.25, 0, 2.27, 0.45, 2.31, 0.95, 1.05, 0.95, 1.05, 0]),
  },
  {
    view: "plan",
    on: TOP,
    fill: GLASS,
    pts: pairs([1.05, 0, 1.05, 0.95, 0.2, 0.95, 0.19, 0.5, 0.17, 0.25, 0.165, 0]),
  },
  // The black along its sills, then its wheel arches, dark inside with black lips.
  {
    view: "side",
    on: LOW,
    fill: BLACK,
    pts: pairs([1.4, -0.1, 3.45, -0.1, 3.45, 0.25, 1.4, 0.262]),
  },
  ...AXLES.flatMap((ua): Decal[] => [
    {
      view: "side",
      on: LOW,
      fill: WELL,
      pts: [...ring(ua, TYRE, 0, ARCH, -15, 195), [ua - 0.43, -0.3], [ua + 0.43, -0.3]],
    },
    { view: "side", on: LOW, fill: BLACK, pts: ring(ua, TYRE, ARCH - 0.004, ARCH + 0.032, -14, 194) },
  ]),
  // Its flush door handles, the camera on its front wing.
  ...[
    [2.27, 2.45, 0.968],
    [1.3, 1.46, 1.006],
  ].map(([u0, u1, z]): Decal => ({
    view: "side",
    on: LOW,
    fill: TRIM,
    pts: pairs([u0, z, u1, z, u1, z + 0.02, u0, z + 0.024]),
  })),
  {
    view: "side",
    on: LOW,
    fill: TRIM,
    pts: pairs([3.58, 0.866, 3.42, 0.866, 3.44, 0.842, 3.52, 0.815]),
  },
  // From behind: the tail lights, fullest at the corners, pointed on the tailgate and a short way round onto its sides
  // (a bright line along their tops), the plate, the badge, and the black lower bumper with its reflectors.
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#5c0a10",
    pts: pairs([
      0.32, 1.12, 0.37, 1.114, 0.6, 1.126, 0.9, 1.133, 1.08, 1.131, 1.15, 1.124, 1.17, 1.13, 1.19, 1.11, 1.16, 1.06,
      1.07, 1.0, 0.92, 0.978, 0.75, 0.99, 0.55, 1.04, 0.32, 1.106,
    ]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#e2333b",
    pts: pairs([
      0.37, 1.1225, 0.6, 1.135, 0.9, 1.142, 1.08, 1.14, 1.15, 1.133, 1.15, 1.124, 1.08, 1.131, 0.9, 1.133, 0.6, 1.126,
      0.37, 1.114,
    ]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#24272c",
    pts: pairs([0, 0.81, 0.168, 0.81, 0.168, 0.82, 0, 0.82]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#24272c",
    pts: pairs([0, 0.97, 0.168, 0.97, 0.168, 0.98, 0, 0.98]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#24272c",
    pts: pairs([0.156, 0.82, 0.168, 0.82, 0.168, 0.97, 0.156, 0.97]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#efefea",
    pts: pairs([0, 0.82, 0.156, 0.82, 0.156, 0.97, 0, 0.97]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#d9dde2",
    pts: pairs([0, 1.163, 0.055, 1.166, 0.05, 1.177, 0.009, 1.174, 0.009, 1.12, 0, 1.12]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#15171a",
    pts: pairs([0, -0.1, 1.42, -0.1, 1.42, 0.33, 1.15, 0.4, 0.9, 0.44, 0.6, 0.46, 0, 0.47]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#22252a",
    pts: pairs([0, 0.33, 0.32, 0.33, 0.3, 0.42, 0, 0.42]),
  },
  {
    view: "tail",
    on: LOW | SIDES | TOP,
    fill: "#7a1016",
    pts: pairs([0.78, 0.468, 0.97, 0.455, 0.97, 0.47, 0.78, 0.484]),
  },
  // From in front: almond headlights on the corners, pointed inside and fuller out where they wrap back into the
  // wings (their slim light along the top), a wide low intake and the fog lights in the corners of a rounded nose, and
  // the badge.
  {
    view: "nose",
    on: LOW | SIDES | TOP,
    fill: LAMP,
    pts: pairs([
      0.36, 0.738, 0.45, 0.749, 0.55, 0.771, 0.8, 0.821, 1.05, 0.861, 1.3, 0.891, 1.4, 0.9, 1.52, 0.92, 1.42, 0.88, 1.2,
      0.815, 1.0, 0.765, 0.8, 0.738, 0.6, 0.724, 0.45, 0.722,
    ]),
  },
  {
    view: "nose",
    on: LOW | SIDES | TOP,
    fill: "#dfe7f5",
    pts: pairs([
      0.45, 0.758, 0.55, 0.78, 0.8, 0.83, 1.05, 0.87, 1.3, 0.9, 1.4, 0.909, 1.4, 0.9, 1.3, 0.891, 1.05, 0.861, 0.8,
      0.821, 0.55, 0.771, 0.45, 0.749,
    ]),
  },
  {
    view: "nose",
    on: LOW | SIDES | TOP,
    fill: "#15171a",
    pts: pairs([0, 0.29, 0.52, 0.29, 0.58, 0.32, 0.56, 0.38, 0, 0.38]),
  },
  {
    view: "nose",
    on: LOW | SIDES | TOP,
    fill: "#2a2e35",
    pts: pairs([0.66, 0.42, 0.86, 0.43, 0.86, 0.452, 0.66, 0.446]),
  },
  {
    view: "nose",
    on: LOW | SIDES | TOP,
    fill: "#d9dde2",
    pts: pairs([0, 0.762, 0.03, 0.763, 0.027, 0.77, 0.006, 0.769, 0.006, 0.742, 0, 0.742]),
  },
];
/** Where a point of the body is in a decal's view. */
function viewOf(v: View, [w, u, z]: P3): P2 {
  const a = Math.abs(w);
  if (v === "side") return [u, z];
  if (v === "plan") return [u, a];
  if (v === "tail") return [a + Math.max(0, u - 0.06), z];
  return [a + Math.max(0, CAR_L - u - 0.06), z];
}
const area2 = (p: P2[]) =>
  p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;
/** The part of `pts` inside a convex outline that turns anticlockwise (Sutherland-Hodgman). */
function clipTo(pts: P2[], win: P2[]): P2[] {
  let out = pts;
  for (let i = 0; i < win.length && out.length; i++) {
    const a = win[i];
    const b = win[(i + 1) % win.length];
    const side = (q: P2) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const next: P2[] = [];
    out.forEach((p, j) => {
      const q = out[(j + 1) % out.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    out = next;
  }
  return out;
}

/** A face of the car, its own way round (out from the middle `w`, along it `u`, up `z`): which way it faces, the way
 * its light falls on it (its corners' normals, smoothed across its neighbours, so a curve shades evenly), what it's
 * painted, and what's painted on it. Mirrors' faces say which side they're on. */
type CarFace = { pts: P3[]; n: P3; light: P3; fill: string; on: { pts: P3[]; fill: string }[]; mirror?: number };
let carFaces: CarFace[] | null = null;
/** Where its cross-sections are along it: closer at its ends, so they round off. */
const CAR_U = [
  0,
  0.012,
  0.028,
  0.045,
  0.06,
  0.08,
  0.11,
  0.15,
  0.2,
  0.26,
  0.33,
  0.41,
  0.5,
  0.6,
  0.72,
  0.85,
  0.98,
  1.12,
  1.27,
  1.43,
  1.6,
  1.78,
  1.96,
  2.12,
  2.28,
  2.44,
  2.6,
  2.76,
  2.92,
  3.08,
  3.24,
  3.4,
  3.54,
  3.68,
  3.82,
  3.96,
  4.1,
  4.23,
  4.35,
  4.4,
  4.45,
  4.49,
  4.53,
  4.565,
  4.6,
  4.625,
  4.65,
  4.67,
  4.69,
  4.705,
  4.718,
  4.728,
  4.737,
  4.743,
  4.747,
  CAR_L,
];

/** The car's faces: its body cut by what's painted on it, then its mirrors. The same every time, so made once. */
function carMesh(): CarFace[] {
  if (carFaces) return carFaces;
  const faces: CarFace[] = [];
  /** Newell's normal, its length the face's area (so a face with two corners in one place still has one). */
  const newell = (pts: P3[]) =>
    pts.reduce(
      (n, a, i) => {
        const b = pts[(i + 1) % pts.length];
        return [
          n[0] + (a[1] - b[1]) * (a[2] + b[2]),
          n[1] + (a[2] - b[2]) * (a[0] + b[0]),
          n[2] + (a[0] - b[0]) * (a[1] + b[1]),
        ] as P3;
      },
      [0, 0, 0] as P3,
    );
  const outward = (n: P3, c: P3, inner: P3) => (dot(n, sub(c, inner)) < 0 ? neg(n) : n);
  const add = (pts: P3[], fill: string, part: number, n: P3, light: P3, mirror?: number) => {
    const f: CarFace = { pts, n: unit(n), light: unit(light), fill, on: [], mirror };
    if (part) paintOn(f, part);
    faces.push(f);
  };
  /** The faces between loops of points, each lit by its corners' normals (the average of the faces round each). */
  const loft = (
    loops: P3[][],
    inner: (c: P3) => P3,
    look: (i: number, j: number) => [string, number],
    mirror?: number,
  ) => {
    const N = loops[0].length;
    const quad = (i: number, j: number) => [
      loops[i][j],
      loops[i][(j + 1) % N],
      loops[i + 1][(j + 1) % N],
      loops[i + 1][j],
    ];
    const fn = loops.slice(1).map((_, i) =>
      Array.from({ length: N }, (_, j) => {
        const pts = quad(i, j);
        const c = mid(pts);
        return outward(newell(pts), c, inner(c));
      }),
    );
    const vn = (i: number, j: number) =>
      [i - 1, i]
        .filter((k) => k >= 0 && k < fn.length)
        .flatMap((k) => [fn[k][(j + N - 1) % N], fn[k][j % N]])
        .reduce((s, n) => addk(s, n), [0, 0, 0] as P3);
    for (let i = 0; i < fn.length; i++)
      for (let j = 0; j < N; j++) {
        if (Math.hypot(...fn[i][j]) < 1e-7) continue;
        const light = [vn(i, j), vn(i, j + 1), vn(i + 1, j), vn(i + 1, j + 1)].reduce((s, n) => addk(s, unit(n)), [
          0, 0, 0,
        ] as P3);
        const [fill, part] = look(i, j);
        add(quad(i, j), fill, part, fn[i][j], dot(light, fn[i][j]) > 0 ? light : fn[i][j], mirror);
      }
  };
  const paintOn = (f: CarFace, part: number) => {
    const sg = Math.sign(f.pts.reduce((s, p) => s + p[0], 0));
    for (const d of DECALS) {
      if (!(d.on & part) || (d.sg && d.sg !== sg)) continue;
      const u = mid(f.pts)[1];
      if ((d.view === "tail" && u > 1.0) || (d.view === "nose" && u < 3.7)) continue;
      let win = f.pts.map((p) => viewOf(d.view, p));
      win = win.filter(
        (p, i) => Math.hypot(p[0] - win[(i + 1) % win.length][0], p[1] - win[(i + 1) % win.length][1]) > 1e-6,
      );
      const fa = area2(win);
      if (win.length < 3 || Math.abs(fa) < 1e-7) continue;
      if (fa < 0) win.reverse();
      const cut = clipTo(d.pts, win);
      if (cut.length < 3) continue;
      const a = Math.abs(area2(cut));
      if (a >= 0.995 * Math.abs(fa)) {
        f.fill = d.fill;
        f.on = [];
      } else if (a > 1e-6) {
        // Back onto the face, by where each point is in the face's two triangles.
        const wv = f.pts.map((p) => viewOf(d.view, p));
        const lift = (q: P2): P3 => {
          let best: { k: number[]; t: number[] } | null = null;
          for (let i = 1; i < f.pts.length - 1; i++) {
            const t = [0, i, i + 1];
            const [p0, p1, p2] = t.map((j) => wv[j]);
            const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
            if (Math.abs(det) < 1e-12) continue;
            const l1 = ((q[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (q[1] - p0[1])) / det;
            const l2 = ((p1[0] - p0[0]) * (q[1] - p0[1]) - (q[0] - p0[0]) * (p1[1] - p0[1])) / det;
            const k = [1 - l1 - l2, l1, l2];
            if (!best || Math.min(...k) > Math.min(...best.k)) best = { k, t };
          }
          if (!best) return f.pts[0];
          const { k, t } = best;
          return [0, 1, 2].reduce((s, i) => addk(s, f.pts[t[i]], k[i]), [0, 0, 0] as P3);
        };
        f.on.push({ pts: cut.map(lift), fill: d.fill });
      }
    }
  };
  // Its body: each strip between one cross-section and the next, round from its underside up one side, over the
  // top and down the other; then its two ends.
  const rings = CAR_U.map((u) => {
    const side = carSide(u);
    return [
      [0, u, CAR.zb(u)] as P3,
      ...side.map(([w, z]): P3 => [-w, u, z]),
      [0, u, CAR.zt(u)] as P3,
      ...[...side].reverse().map(([w, z]): P3 => [w, u, z]),
    ];
  });
  const body = (c: P3): P3 => [0, Math.min(3.8, Math.max(0.9, c[1])), 0.72];
  loft(rings, body, (_, j) => {
    // Which of its side's points it starts from (counted from the sill up), or its underside's.
    const k = j === 0 || j === 2 * SIDE_N + 1 ? -1 : j <= SIDE_N ? j - 1 : 2 * SIDE_N - j;
    return [PAINT, k < 7 ? LOW : k < 10 ? SIDES : TOP];
  });
  for (const r of [rings[0], rings[rings.length - 1]]) {
    const n = outward(newell(r), mid(r), body(mid(r)));
    add(r, PAINT, LOW, n, n);
  }
  // Its mirrors on the front doors, at the windows' front corners: a short black stalk, then a teardrop cap in its
  // paint, rounded in front and flat behind, where its glass faces back.
  const SECTIONS: [number, number, number, number, number][] = [
    [0.82, 3.13, 1.11, 0.026, 0.018],
    [0.885, 3.12, 1.118, 0.026, 0.018],
    [0.89, 3.11, 1.126, 0.045, 0.032],
    [0.93, 3.1, 1.137, 0.08, 0.048],
    [0.985, 3.09, 1.146, 0.104, 0.058],
    [1.035, 3.085, 1.149, 0.1, 0.056],
    [1.06, 3.083, 1.148, 0.075, 0.044],
    [1.072, 3.082, 1.147, 0.032, 0.024],
  ];
  for (const sg of [-1, 1]) {
    const loops = SECTIONS.map(([w, uc, zc, au, az]) =>
      Array.from({ length: 12 }, (_, i): P3 => {
        const a = (i * Math.PI) / 6;
        const c = Math.cos(a);
        return [sg * w, uc + au * (c > 0 ? c : 0.35 * c), zc + az * Math.sin(a)];
      }),
    );
    loft(
      loops,
      () => [sg * 0.95, 3.09, 1.135],
      (i, j) => [i < 2 ? TRIM : Math.cos(((j + 0.5) * Math.PI) / 6) < -0.5 && i > 2 && i < 6 ? GLASS : PAINT, 0],
      sg,
    );
    const tip = loops[loops.length - 1];
    const n = outward(newell(tip), mid(tip), [sg * 0.95, 3.09, 1.14]);
    add(tip, PAINT, 0, n, n, sg);
  }
  carFaces = faces;
  return faces;
}

/**
 * The car and the socket it charges from. The socket's always there (its light green while the car's home); the car,
 * a low-poly Model Y in your car's paint, only while it's home: nose-in on the driveway (lit by the sun) or in the
 * garage (under the garage's own light), its cable from the socket along its left side up to its charge port, in its
 * left tail light. Its faces show only where the camera can see them, so nothing on the far side shows through it; the
 * wheels and mirrors on a side you can't see go behind it, the ones on a side you can in front.
 */
function carScene(B: Builder, g: Geometry, parts: SceneParts) {
  const C = g.car;
  const { inGarage, x0, x1, cy } = C;
  const SF = C.socket;
  if (!parts.ev) return;
  B.layer = C.socketLayer;
  if (B.facing(addk(SF.o, [0, 0, 1.1]), SF.n)) {
    const sq = boxOn(B, SF, 0, 0.24, 0, 0.11, 0.95, 1.27, "#e1e4e7", "#c8cdd2", "#eef0f2");
    const d = B.cam.poly([sq(0.15, 0.112, 1.15), sq(0.2, 0.112, 1.15), sq(0.2, 0.112, 1.2), sq(0.15, 0.112, 1.2)]);
    if (d)
      B.items.push({
        layer: B.layer,
        depth: -1e5,
        shapes: [{ d: "", raw: `<path d="${d}" fill="${parts.car ? "#4ade80" : "#9aa1a9"}"/>` }],
      });
  }
  B.layer = 0;
  if (!parts.car) return;
  B.layer = C.layer;
  const P = (x: number, u: number, z: number): P3 => [x, cy - u, z];
  const mx = (x0 + x1) / 2;
  /** From the car's own way round to the scene's. */
  const W = ([w, u, z]: P3): P3 => [mx + w, cy - u, z];
  const eye = B.cam.eye;
  const out = eye[0] - mx;
  /** Whether the camera's out past a side of it (+1 its left, the scene's east; -1 its right). */
  const sees = (sg: number, w: number) => sg * out > w;
  const lit = (fill: string, n: P3) => {
    if (DARK.has(fill)) return css(mix(rgb(fill), [150, 170, 195], clamp01(n[2]) * 0.18 * B.sun.sky));
    const c = fill === PAINT ? parts.paint : fill;
    // In the garage, its paint's shaded by the light overhead, so its shape still shows.
    if (inGarage) return css(rgb(c).map((v) => v * (0.6 + 0.4 * Math.max(0, dot(n, [0.24, 0.34, 0.91])))) as Rgb);
    // The paint's light wraps a little round it, so it shades off evenly where it turns from the sun.
    return fill === PAINT ? litColour(c, n, B.sun, 0.35) : css(mix(rgb(c), litRGB(rgb(c), n, B.sun), 0.5));
  };
  type Drawn = Shape & { depth: number };
  const body: Drawn[][] = [];
  const mirrors: Record<string, Drawn[][]> = { near: [], far: [] };
  for (const f of carMesh()) {
    const pts = f.pts.map(W);
    const n: P3 = [f.n[0], -f.n[1], f.n[2]];
    const ln: P3 = [f.light[0], -f.light[1], f.light[2]];
    const c = mid(pts);
    if (!B.facing(c, n)) continue;
    const d = B.cam.poly(pts);
    if (!d) continue;
    const depth = B.cam.depth(c);
    // Edged in its own colour; what's painted on it a little more, so it covers its face's edge and its neighbours'
    // where it runs on across them.
    const group: Drawn[] = [{ depth, d, fill: lit(f.fill, ln), seam: f.on.length ? 0.8 : 1 }];
    for (const o of f.on) {
      const od = B.cam.poly(o.pts.map(W));
      if (od) group.push({ depth, d: od, fill: lit(o.fill, ln), seam: 1.5 });
    }
    if (f.mirror) mirrors[sees(f.mirror, 0.86) ? "near" : "far"].push(group);
    else body.push(group);
  }
  const byDepth = (gs: Drawn[][]) => gs.sort((a, b) => b[0].depth - a[0].depth).flat();

  // Its wheels: the tyre's tread and sidewall, the 19-inch aero cover (silver, ten fine curved vanes round a small hub).
  // On a side you can see, in front of it, through its arch; on the other, behind it. Each side's furthest first, so
  // from behind its front wheels don't show over its back ones.
  const nearWheels: Drawn[][] = [];
  const farWheels: Drawn[][] = [];
  const path = (pts: P2[]) => (pts.length > 2 ? `M${pts.map((q) => q.map(n1).join(" ")).join(" L")} Z` : "");
  for (const sg of [-1, 1])
    for (const ua of AXLES) {
      const depth = B.cam.depth(W([sg * WHEEL_W, ua, TYRE]));
      const wheel: Drawn[] = [];
      const push = (...xs: Shape[]) => wheel.push(...xs.map((x) => ({ ...x, depth })));
      const disc = (r: number, w: number, steps = 24) =>
        Array.from({ length: steps }, (_, i) => {
          const a = (i / steps) * Math.PI * 2;
          return W([sg * w, ua + r * Math.cos(a), TYRE + r * Math.sin(a)]);
        });
      const flat = [...disc(TYRE, WHEEL_W), ...disc(TYRE, WHEEL_W - 0.245)].map((q) => B.cam.p(q));
      if (flat.some((q) => !q)) continue;
      const tread = { d: path(hull(flat as P2[])), fill: "#222428" };
      if (!sees(sg, WHEEL_W)) {
        push(tread);
        farWheels.push(wheel);
        continue;
      }
      const n: P3 = [sg, 0, 0];
      const arch = [
        ...ring(ua, TYRE, 0, ARCH + 0.01, -15, 195).map(([u, z]) => carAt(u, z, sg, 0.01)),
        carAt(ua - 0.43, 0.24, sg, 0.01),
        [sg * WHEEL_W, ua - 0.43, -0.4] as P3,
        [sg * WHEEL_W, ua + 0.43, -0.4] as P3,
        carAt(ua + 0.43, 0.24, sg, 0.01),
      ].map(W);
      const clip = B.cam.poly(arch);
      const cover = (r: number, w: number, fill: string, steps = 24) => ({
        d: B.cam.poly(disc(r, w, steps)),
        fill,
        clip,
      });
      push({ ...tread, clip }, cover(TYRE, WHEEL_W, "#2a2c31"), cover(0.235, WHEEL_W + 0.004, lit("#c3c7cc", n)));
      for (let k = 0; k < 10; k++) {
        const a0 = (k / 10) * Math.PI * 2 + 0.4;
        const vane = (side: number) =>
          [0, 0.25, 0.5, 0.75, 1].map((t) => {
            const r = 0.075 + t * 0.15;
            const a = a0 + sg * t * 0.55 + (side * (0.015 - 0.005 * t)) / r;
            return W([sg * (WHEEL_W + 0.006), ua + r * Math.cos(a), TYRE + r * Math.sin(a)]);
          });
        push({ d: B.cam.poly([...vane(1), ...vane(-1).reverse()]), fill: "#4a4f57", clip });
      }
      push(cover(0.06, WHEEL_W + 0.008, lit("#9da3aa", n), 14), cover(0.03, WHEEL_W + 0.01, "#2a2d32", 10));
      nearWheels.push(wheel);
    }

  // The lines over its paint, on whichever sides the camera sees: on its side, its doors' shut lines (the back one
  // round its rear arch); from behind, the tailgate's.
  const lines: Shape[] = [];
  const line = (pts: P3[], width = 0.9) => lines.push({ d: B.cam.line(pts.map(W)), stroke: "rgba(0,0,0,.24)", width });
  for (const sg of [-1, 1]) {
    if (!sees(sg, 0.9)) continue;
    const at = (u: number, z: number) => carAt(u, z, sg);
    const belt = (u: number) => CAR.zbelt(u) - 0.008;
    line([at(3.375, belt(3.375)), at(3.36, 0.7), at(3.345, 0.27)]);
    line([at(2.15, belt(2.15)), at(2.13, 0.27)]);
    line([
      at(1.17, belt(1.17)),
      at(1.19, 1.0),
      ...ring(AXLES[0], TYRE, 0, ARCH + 0.06, 64, 0, 8).map(([u, z]) => at(u, z)),
      at(AXLES[0] + ARCH + 0.06, 0.27),
    ]);
  }
  if (eye[1] > cy) {
    const tg: P2[] = [
      [0.56, 1.2],
      [0.545, 1.12],
      [0.54, 1.0],
      [0.545, 0.87],
      [0.51, 0.775],
      [0.42, 0.745],
      [0.2, 0.74],
    ];
    line([...tg.map(([w, z]) => carEnd(w, z, false)), ...[...tg].reverse().map(([w, z]) => carEnd(-w, z, false))]);
  }
  const port = sees(1, 0.9)
    ? B.cam.poly(
        [
          carAt(0.17, 1.0, 1, 0.012),
          carAt(0.29, 1.0, 1, 0.012),
          carAt(0.29, 1.075, 1, 0.012),
          carAt(0.17, 1.075, 1, 0.012),
        ].map(W),
      )
    : "";
  const portAt = W(carAt(0.23, 1.04, 1, 0.012));
  // The cable from the socket down to the floor, along the car's left side and up into its port.
  let run: P3[];
  let last: P3[];
  if (inGarage) {
    const sock: P3 = [SF.o[0] - 0.06, 5.67, 0.95];
    const lane = x1 + 0.25;
    run = [sock, [sock[0], sock[1], 0.05], [lane, 5.6, 0.03]];
    last = [[lane, 5.6, 0.03], [lane, cy - 0.45, 0.03], [x1 + 0.1, cy - 0.4, 0.38], portAt];
  } else {
    const walled = g.garage && !g.garage.carport;
    const sock: P3 = walled ? [10.24, g.garage!.y1 + 0.06, 0.95] : [10.06, 7.5, 0.95 + g.z0];
    const lane = x1 + 0.32;
    run = [
      sock,
      [sock[0], sock[1], 0.05],
      walled ? [10.6, 7.5, 0.03] : [10.45, 7.95, 0.03],
      [lane, 8.55, 0.03],
      [lane, 9.3, 0.03],
    ];
    last = [[lane, 9.3, 0.03], [lane, cy - 0.5, 0.03], [x1 + 0.12, cy - 0.38, 0.38], portAt];
  }
  const cable: Drawn[] = [];
  const all = [...run, ...last.slice(1)];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1];
    const q = all[i];
    const d = B.cam.seg(a, q);
    const dep = B.cam.depth(lerp3(a, q, 0.5));
    if (d)
      cable.push({ depth: dep, d, stroke: "#25282d", width: Math.max(1.4, Math.min(3.4, (0.03 * B.cam.focal) / dep)) });
  }
  const sorted = byDepth([...body, ...cable.map((c) => [c])]).map(({ depth: _, ...x }) => x);
  const strip = (xs: Drawn[]) => xs.map(({ depth: _, ...x }) => x);
  const foot = [
    P(x0 - 0.06, -0.05, 0.004),
    P(x1 + 0.06, -0.05, 0.004),
    P(x1 + 0.06, CAR_L + 0.05, 0.004),
    P(x0 - 0.06, CAR_L + 0.05, 0.004),
  ];
  // Under it, deeper shade between its wheels, so what shows of its far wheels sits in it rather than floating.
  const under = [
    P(x0 + 0.03, AXLES[0] - 0.3, 0.005),
    P(x1 - 0.03, AXLES[0] - 0.3, 0.005),
    P(x1 - 0.03, AXLES[1] + 0.3, 0.005),
    P(x0 + 0.03, AXLES[1] + 0.3, 0.005),
  ];
  const shapes: Shape[] = [
    { d: B.cam.poly(foot), fill: SHADOW, opacity: 0.32 },
    { d: B.cam.poly(under), fill: SHADOW, opacity: 0.45 },
    ...strip(byDepth(farWheels)),
    ...strip(byDepth(mirrors.far)),
    ...sorted,
    ...strip(byDepth(mirrors.near)),
    ...strip(byDepth(nearWheels)),
    ...lines,
  ];
  B.add(B.cam.depth(P((x0 + x1) / 2, 2.4, 0.7)), ...(inGarage ? shapes.map((x) => ({ ...x, inside: true })) : shapes));
  // Its cable's power and its port's light, drawn right after it.
  B.items.push({
    layer: B.layer,
    depth: -1e5,
    shapes: [{ d: "", slot: { kind: "car", flow: sees(1, 0.9) ? B.cam.line(last) : "", port } }],
  });
  if (!inGarage)
    B.casters.push(
      CAR_U.filter((_, i) => i % 4 === 0).flatMap((u) => {
        const side = carSide(u);
        return [side[3], side[10]].flatMap(([w, z]) => [W([-w, u, z]), W([w, u, z])]);
      }),
    );
  B.layer = 0;
}

// The street's power poles (one out the front with a transformer) along the footpath.
const POLES = Array.from({ length: 11 }, (_, i) => -148 + 30 * i);
const POLE_Y = 17.35;
const ARM = 8.7;

/**
 * The street's power: timber poles every 30 m with a crossarm and insulators, a transformer on the one out the front,
 * sagging wires between them, and the service line from that pole to a bracket on the eave, down a conduit to the meter
 * box on the front wall. Its power's comets (violet buying, amber selling) go in slots right after the line and the
 * conduit.
 */
function gridScene(B: Builder, g: Geometry) {
  B.layer = 6;
  const wire = (pts: P3[], w = 0.026) => {
    const m = pts[Math.floor(pts.length / 2)];
    const d = B.cam.line(pts);
    if (!d) return 0;
    const dep = B.cam.depth(m);
    B.add(dep, { d, stroke: "#26292e", width: Math.max(0.6, Math.min(2.4, (w * B.cam.focal) / Math.max(1, dep))) });
    return dep;
  };
  const ends = [-0.85, -0.3, 0.85];
  POLES.forEach((x, i) => {
    const base: P3 = [x, POLE_Y, 0];
    if (B.cam.depth(base) < 1) return;
    const shapes = [
      ...rod(B, base, [x, POLE_Y, 9.3], 0.17, 0.11, "#8a7a66"),
      ...rod(B, [x - 1.05, POLE_Y, ARM], [x + 1.05, POLE_Y, ARM], 0.07, 0.07, "#76685a"),
    ];
    for (const e of ends)
      shapes.push(...rod(B, [x + e, POLE_Y, ARM], [x + e, POLE_Y, ARM + 0.16], 0.045, 0.035, "#c9cdd2"));
    if (x === 2)
      shapes.push(
        ...rod(B, [x + 0.42, POLE_Y, 6.9], [x + 0.42, POLE_Y, 7.9], 0.3, 0.3, "#9aa0a6"),
        ...rod(B, [x + 0.42, POLE_Y, 7.9], [x + 0.42, POLE_Y, 8.0], 0.24, 0.2, "#b9bec4"),
      );
    B.add(B.cam.depth(base), ...shapes);
    B.casters.push([
      [x - 0.15, POLE_Y, 0],
      [x + 0.15, POLE_Y, 0],
      [x - 1.05, POLE_Y, ARM],
      [x + 1.05, POLE_Y, ARM],
    ]);
    if (i < POLES.length - 1)
      for (const e of ends) wire(sag([x + e, POLE_Y, ARM + 0.16], [POLES[i + 1] + e, POLE_Y, ARM + 0.16], 0.55));
  });
  // The service line to the house: from the pole to a bracket on the eave.
  const top = g.eave;
  const drop = sag([2.85, POLE_Y, ARM + 0.16], [0.85, 8.5, top + 0.35], 0.5, 12);
  const dropDepth = wire(drop, 0.03);
  if (dropDepth)
    B.items.push({
      layer: 6,
      depth: dropDepth - 1e-3,
      shapes: [{ d: "", slot: { kind: "drop", d: B.cam.line(drop) } }],
    });
  B.layer = 0.95;
  B.add(0, ...rod(B, [0.85, 8.5, top - 0.25], [0.85, 8.5, top + 0.4], 0.03, 0.03, "#9aa1a9"));
  // The meter box on the front wall, and the conduit down to it: only when that wall faces the camera.
  B.layer = 0;
  if (!B.wallItems.front) return;
  B.layer = 1;
  const MF: Frame = { o: [0.46, 8, g.z0], a: [1, 0, 0], n: [0, 1, 0] };
  const qm = (u: number, o: number, z: number): P3 => addk(addk(addk(MF.o, MF.a, u), MF.n, o), [0, 0, z]);
  const door = B.cam.line([
    qm(0.04, 0.172, 1.19),
    qm(0.53, 0.172, 1.19),
    qm(0.53, 0.172, 1.91),
    qm(0.04, 0.172, 1.91),
    qm(0.04, 0.172, 1.19),
  ]);
  const glass = B.cam.poly([qm(0.14, 0.173, 1.6), qm(0.42, 0.173, 1.6), qm(0.42, 0.173, 1.8), qm(0.14, 0.173, 1.8)]);
  boxOn(B, MF, 0, 0.57, 0, 0.17, 1.15, 1.95, "#e7e2d3", "#d0cab8", "#f1ede2", [
    { d: door, stroke: "#b9b19c", width: 1 },
    { d: glass, fill: "#26303b" },
  ]);
  const conduit = [qm(0.39, 0.05, top - g.z0 - 0.05), qm(0.39, 0.05, 1.95)];
  B.add(
    -1e4,
    { d: B.cam.line(conduit), stroke: "#aab1ba", width: 4.4 },
    { d: B.cam.line(conduit), stroke: "#d6dbe1", width: 2 },
  );
  B.items.push({
    layer: 1,
    depth: -1e5,
    shapes: [
      {
        d: "",
        slot: {
          kind: "meter",
          conduit: B.cam.line([[0.85, 8.5, top + 0.35], [0.85, 8.06, top - 0.05], qm(0.39, 0.05, 1.95)]),
          led: B.cam.poly([qm(0.2, 0.174, 1.66), qm(0.24, 0.174, 1.66), qm(0.24, 0.174, 1.7), qm(0.2, 0.174, 1.7)]),
        },
      },
    ],
  });
  B.layer = 0;
}

// ------------------------------------------------------------------------------------------------- what makes it lit

/**
 * What makes it read as built and lit rather than drawn: shadows cast by the sun (the house on the lawn, the eaves on
 * the walls, the battery and inverter on theirs), soft dark where things meet, downpipes, the undersides of the eaves,
 * and shrubs in the garden beds.
 */
function litExtras(B: Builder, K: ReturnType<typeof kit>, g: Geometry, mountWall: Item | null) {
  const sun = B.sun;
  const s = sun.dir;
  const day = clamp01(sun.el / 8) * (0.55 + 0.45 * sun.L) * (1 - 0.8 * sun.cover);
  const amb = 0.5 + 0.5 * sun.L;
  const { eave, z0, garage } = g;
  // Points carried along the light onto a plane, as one outline: the shadow they cast there.
  const shadowOn = (pts: P3[], o: P3, n: P3) => {
    const sn = dot(s, n);
    if (sn <= 0.02 || day <= 0.01) return "";
    const c = cross(n, [0, 0, 1]);
    const e1: P3 = Math.hypot(...c) < 1e-6 ? [1, 0, 0] : unit(c);
    const e2 = cross(n, e1);
    const flat = pts.map((p): P2 => {
      const r = sub(addk(p, s, -dot(sub(p, o), n) / sn), o);
      return [dot(r, e1), dot(r, e2)];
    });
    return B.cam.poly(hull(flat).map(([a, b]) => addk(addk(addk(o, e1, a), e2, b), n, 0.006)));
  };

  // On the lawn: the house's shadow, and the dark along the foot of its walls.
  B.layer = -1.5;
  const hz = eave + 0.1;
  const mass: P3[] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 8, 0],
    [0, 8, 0],
    [0, 0, hz],
    [10, 0, hz],
    [10, 8, hz],
    [0, 8, hz],
    ...B.roofPts,
  ];
  if (garage)
    mass.push(
      [garage.x1, garage.y0, 0],
      [garage.x1, garage.y1, 0],
      [garage.x1, garage.y0, garage.h],
      [garage.x1, garage.y1, garage.h],
    );
  B.add(1e4, { d: shadowOn(mass, [0, 0, 0.015], [0, 0, 1]), fill: SHADOW, opacity: +(0.36 * day).toFixed(2) });
  for (const pts of B.casters)
    B.add(1e4, { d: shadowOn(pts, [0, 0, 0.017], [0, 0, 1]), fill: SHADOW, opacity: +(0.3 * day).toFixed(2) });
  for (const [w, op] of [
    [0.25, 0.16],
    [0.7, 0.07],
  ]) {
    const strip = (pts: P3[]) => B.add(1e4, { d: B.cam.poly(pts), fill: SHADOW, opacity: +(op * amb).toFixed(2) });
    strip([
      [0, 8, 0.016],
      [10, 8, 0.016],
      [10, 8 + w, 0.016],
      [0, 8 + w, 0.016],
    ]);
    if (!garage)
      strip([
        [10, 0, 0.016],
        [10 + w, 0, 0.016],
        [10 + w, 8, 0.016],
        [10, 8, 0.016],
      ]);
    else if (!garage.carport)
      strip([
        [garage.x1, garage.y0, 0.016],
        [garage.x1 + w, garage.y0, 0.016],
        [garage.x1 + w, garage.y1, 0.016],
        [garage.x1, garage.y1, 0.016],
      ]);
  }

  // On the walls: the dark at their feet and under the eaves, a downpipe or two, the eaves' shadow, and their undersides.
  B.layer = 0;
  for (const [key, w] of Object.entries(B.wallItems) as ["front" | "side", Item][]) {
    if (!w.n || !w.pts || !w.d) continue;
    const n = w.n;
    const band = (za: number, zb: number) =>
      B.cam.poly([0, 1, 1, 0].map((i, k) => addk([w.pts![i][0], w.pts![i][1], k < 2 ? za : zb], n, 0.005)));
    w.shapes.push({ d: band(z0, z0 + 0.16), fill: SHADOW, opacity: +(0.14 * amb).toFixed(2) });
    const pipes: [number, number][] =
      key === "front"
        ? [
            [0.3, 8],
            [9.7, 8],
          ]
        : [[10, 0.35]];
    for (const [x, y] of pipes) {
      const d = B.cam.seg(addk([x, y, eave - 0.04], n, 0.07), addk([x, y, 0.05], n, 0.07));
      w.shapes.push({ d, stroke: "#7f878f", width: 5.2, opacity: 0.55 }, { d, stroke: "#e2e5e8", width: 3.2 });
    }
    w.shapes.push(
      { d: band(eave - 0.32, eave + 0.1), fill: SHADOW, opacity: +(0.16 * amb).toFixed(2) },
      { d: band(eave - 0.8, eave + 0.1), fill: SHADOW, opacity: +(0.07 * amb).toFixed(2) },
    );
    const cast = shadowOn(B.roofPts, w.pts[0], n);
    if (cast) w.shapes.push({ d: cast, fill: SHADOW, opacity: +(0.38 * day).toFixed(2), clip: w.d });
    // The eave's underside, seen from below it.
    if (B.cam.eye[2] < eave)
      for (const pl of B.eaves) {
        const out = unit([-pl.s[0], -pl.s[1], 0]);
        const o = pl.P(0, 0);
        const oh = key === "front" ? o[1] - 8 : o[0] - 10;
        if (Math.abs(o[2] - eave) > 0.01 || dot(out, n) < 0.99 || oh < 0.1 || oh > 1) continue;
        const under = [o, pl.P(pl.L, 0), addk(pl.P(pl.L, 0), out, -oh), addk(o, out, -oh)];
        w.shapes.push({ d: B.cam.poly(under), fill: B.light("#ebe7de", under) });
      }
  }

  // The battery and inverter: dark where they stand, and their shadows on the wall in the sun.
  B.layer = kitLayer(g.mount);
  if (K.battery && K.shown)
    B.add(1e5, {
      d: B.cam.poly([K.q(-0.07, 0, 0.004), K.q(0.73, 0, 0.004), K.q(0.73, 0.36, 0.004), K.q(-0.07, 0.36, 0.004)]),
      fill: SHADOW,
      opacity: 0.28,
    });
  if (!g.mount.inside && mountWall?.d)
    for (const bx of K.boxes) {
      const [u0, u1, o0, o1, za, zb] = bx;
      const corners = [u0, u1].flatMap((u) => [o0, o1].flatMap((o) => [za, zb].map((z) => K.q(u, o, z))));
      const d = shadowOn(corners, g.mount.o, g.mount.n);
      if (d) B.add(1e5, { d, fill: SHADOW, opacity: +(0.38 * day).toFixed(2), clip: mountWall.d });
    }

  // Shrubs in the garden beds, lit from above.
  B.layer = 0.8;
  const blob = (cx: number, cy: number, rx: number, ry: number) =>
    `M${n1(cx - rx)} ${n1(cy)} a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(2 * rx)} 0 a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(-2 * rx)} 0 Z`;
  const bush = (x: number, y: number, r: number) => {
    const base: P3 = [x, y, 0];
    const p = B.cam.p([x, y, r * 0.75]);
    if (!p || B.cam.depth(base) < NEAR) return;
    const R = (r * B.cam.focal) / B.cam.depth(base);
    const body =
      blob(p[0], p[1], R * 1.05, R * 0.78) +
      blob(p[0] - R * 0.62, p[1] + R * 0.18, R * 0.62, R * 0.52) +
      blob(p[0] + R * 0.66, p[1] + R * 0.14, R * 0.66, R * 0.54);
    const top = blob(p[0] - R * 0.18, p[1] - R * 0.32, R * 0.62, R * 0.38);
    B.add(
      B.cam.depth(base),
      { d: body, fill: "#4d6b45" },
      { d: top, fill: "#8fae74", opacity: +(0.3 + 0.4 * sun.L).toFixed(2) },
    );
  };
  for (const [x, r] of [
    [0.7, 0.46],
    [2.2, 0.4],
    [3.7, 0.5],
    [6.3, 0.44],
    [7.8, 0.5],
    [9.3, 0.42],
  ])
    bush(x, 8.6, r);
  if (!garage) for (const y of [7.3, 8.25]) bush(10.55, y, 0.4);
  B.layer = 0;
}

// ------------------------------------------------------------------------------------------------- the trees

type Crown = { off: P3; r: P3; j: number[]; f: number[] };
type Tree = {
  at: P3;
  t: number;
  gum: boolean;
  trunk: number;
  crowns: Crown[];
  leaf: Rgb;
  bark: Rgb;
  r: number;
  h: number;
};

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: P3[] = (
  [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ] as P3[]
).map(unit);
const ICO_F = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/** How many trees each garden has out to the horizon, and how many of them are gums. */
const GARDENS: Record<Garden, { n: number; gums: number }> = {
  native: { n: 110, gums: 0.85 },
  leafy: { n: 110, gums: 0.3 },
  tropical: { n: 100, gums: 0.45 },
  minimal: { n: 60, gums: 0.62 },
};
const forests = new Map<Garden, Tree[]>();

/**
 * The trees round the house, out to the horizon, the same every time: faceted solids (an icosahedron, its corners
 * pushed in and out a little per tree). Gums have a tall pale trunk forking into two or three flat, open crowns; shade
 * trees a short dark trunk under one rounder crown.
 */
function forest(garden: Garden): Tree[] {
  const hit = forests.get(garden);
  if (hit) return hit;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { n, gums } = GARDENS[garden];
  const out: Tree[] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 55 + rnd() * 160;
    const t = rnd();
    const gum = rnd() < gums;
    const spin = rnd() * Math.PI;
    const crown = (off: P3, r: P3): Crown => ({
      off,
      r,
      j: ICO_V.map(() => 0.78 + rnd() * 0.4),
      f: ICO_F.map(() => rnd() * 0.12 - 0.06),
    });
    let trunk: number;
    let crowns: Crown[];
    if (gum) {
      trunk = 4.5 + rnd() * 4;
      const k = 2 + (rnd() < 0.5 ? 1 : 0);
      crowns = Array.from({ length: k }, (_, c) => {
        const ang = spin + (c / k) * Math.PI * 2 + rnd() * 0.6;
        const dd = 0.9 + rnd() * 1.4;
        const s2 = 1.5 + rnd() * 1.1;
        return crown(
          [Math.cos(ang) * dd, Math.sin(ang) * dd, trunk + 0.6 + rnd() * 1.8],
          [s2 * 1.25, s2 * 1.25, s2 * 0.62],
        );
      });
    } else {
      trunk = 1.8 + rnd() * 1.2;
      const s2 = 2.6 + rnd() * 1.6;
      crowns = [crown([0, 0, trunk + s2 * 0.75], [s2 * 1.1, s2 * 1.1, s2 * 0.9])];
    }
    out.push({
      at: [5 + Math.cos(a) * d, 4 + Math.sin(a) * d, 0],
      t,
      gum,
      trunk,
      crowns,
      leaf: gum ? [104 + 18 * t, 122 + 16 * t, 92 + 10 * t] : [60 + 20 * t, 92 + 22 * t, 62 + 12 * t],
      bark: gum ? [216, 210, 196] : [104, 88, 74],
      r: Math.max(...crowns.map((cr) => Math.hypot(cr.off[0], cr.off[1]) + cr.r[0])),
      h: Math.max(...crowns.map((cr) => cr.off[2] + cr.r[2])),
    });
  }
  forests.set(garden, out);
  return out;
}

/** The trees, far to near under everything built: each crown's faces lit one by one, hazier with distance, with a
 * shadow on the lawn. On a device that can't keep up (`lite`), every other tree. */
function trees(B: Builder, garden: Garden, w: number, lite: boolean) {
  const c = B.cam;
  const sun = B.sun;
  B.layer = -1;
  const flatSun = unit([sun.dir[0], sun.dir[1], 1e-6]);
  const blob = (cx: number, cy: number, rx: number, ry: number) =>
    `M${n1(cx - rx)} ${n1(cy)} a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(2 * rx)} 0 a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(-2 * rx)} 0 Z`;
  const all = forest(garden);
  for (let ti = 0; ti < all.length; ti++) {
    if (lite && ti % 2) continue;
    const t = all[ti];
    const base = c.p(t.at);
    if (!base) continue;
    const dep = c.depth(t.at);
    const r = (t.r * c.focal) / dep;
    if (base[0] < -r * 3 || base[0] > w + r * 3) continue;
    const haze = clamp01((dep - 45) / 230) * 0.55;
    const tone = (col: Rgb) => css(mix(mix(col, sun.horizon, haze), [16, 24, 34], 1 - sun.sky));
    if (sun.el > 1 && sun.L > 0.05) {
      const reach = Math.min(t.h * 1.6, (t.h * 0.55) / Math.max(Math.tan((sun.el * Math.PI) / 180), 0.35));
      const sc = c.p(addk(t.at, flatSun, -reach * 0.6));
      if (sc) {
        B.layer = -1.4;
        B.add(dep, {
          d: blob(sc[0], sc[1], r * 1.1, r * 0.28),
          fill: SHADOW,
          opacity: +(0.2 * clamp01(sun.el / 8) * (1 - haze) * (1 - 0.8 * sun.cover)).toFixed(2),
        });
        B.layer = -1;
      }
    }
    // The trunk, tapering, its sunny side lighter; a gum's forks up to each crown.
    const shapes: Shape[] = [];
    const top = addk(t.at, [0, 0, t.trunk]);
    const pt = c.p(top);
    const pl = c.p(addk(top, sun.dir, 1));
    const lx = pt && pl ? pl[0] - pt[0] : -1;
    const ly = pt && pl ? pl[1] - pt[1] : 0;
    const limb = (a: P3, b: P3, w0: number, w1: number, col: Rgb) => {
      const pa = c.p(a);
      const pb = c.p(b);
      if (!pa || !pb) return;
      const ka = c.focal / c.depth(a);
      const kb = c.focal / c.depth(b);
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const m = Math.hypot(dx, dy) || 1;
      const nx = -dy / m;
      const ny = dx / m;
      const side = (f: number) =>
        `M${n1(pa[0] + nx * w0 * ka * f)} ${n1(pa[1] + ny * w0 * ka * f)} L${n1(pb[0] + nx * w1 * kb * f)} ${n1(pb[1] + ny * w1 * kb * f)} L${n1(pb[0])} ${n1(pb[1])} L${n1(pa[0])} ${n1(pa[1])} Z`;
      const sunSide = nx * lx + ny * ly >= 0 ? 1 : -1;
      shapes.push(
        { d: side(sunSide), fill: tone(mix(col, [255, 250, 236], 0.25 * sun.L)) },
        { d: side(-sunSide), fill: tone(col.map((v) => v * 0.7) as Rgb) },
      );
    };
    limb(t.at, top, 0.2, 0.1, t.bark);
    if (t.gum)
      for (const cr of t.crowns)
        limb(top, addk(t.at, [cr.off[0] * 0.8, cr.off[1] * 0.8, cr.off[2] - cr.r[2] * 0.4]), 0.09, 0.04, t.bark);
    const faces: { depth: number; d: string; fill: string }[] = [];
    for (const cr of t.crowns) {
      const ctr = addk(t.at, cr.off);
      const V = ICO_V.map((v, i): P3 => [
        ctr[0] + v[0] * cr.r[0] * cr.j[i],
        ctr[1] + v[1] * cr.r[1] * cr.j[i],
        ctr[2] + v[2] * cr.r[2] * cr.j[i],
      ]);
      ICO_F.forEach(([a, b, e], fi) => {
        const pts = [V[a], V[b], V[e]];
        const m = mid(pts);
        let n = unit(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
        if (dot(n, sub(m, ctr)) < 0) n = neg(n);
        if (dot(sub(c.eye, m), n) <= 0) return;
        const d = c.poly(pts);
        if (d)
          faces.push({
            depth: c.depth(m),
            d,
            fill: tone(litRGB(t.leaf.map((v) => v * (1 + cr.f[fi])) as Rgb, n, sun)),
          });
      });
    }
    faces.sort((x, y) => y.depth - x.depth);
    // The trees keep their own night (tone() darkens them), so the light of the moment isn't baked into them again.
    B.add(dep, ...[...shapes, ...faces].map((x) => ({ ...x, own: true })));
  }
  B.layer = 0;
}

// ------------------------------------------------------------------------------------------------- the picture

const cache = new Map<string, HouseArt>();
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The parts of the house that make a picture differ, as a key. */
export function houseKey(o: HouseOptions) {
  return [
    o.style,
    o.storeys,
    o.roof,
    o.walls,
    o.panels,
    o.garage,
    o.garageKind,
    o.garden,
    o.batteries.join(","),
    o.inverters.join(","),
    o.cars[0] ?? "",
  ].join("|");
}

/**
 * Your house through the camera at `pose`, in `light`. Pictures are kept for the last few cameras and lights (a page's
 * spot, as the day's scrubbed); `keep` false while the camera's flying, when each frame's is new.
 */
export function houseArt(
  o: HouseOptions,
  phone: boolean,
  pose: Pose,
  light: Light,
  parts: SceneParts,
  lite: boolean,
  keep = true,
): HouseArt {
  const key = keep
    ? [
        phone,
        houseKey(o),
        [...pose.eye, ...pose.at, pose.fov, pose.cx, pose.cy].map(r2).join(","),
        [
          ...light.dir,
          light.el,
          light.L,
          light.warm,
          light.cover,
          light.sky,
          ...light.horizon,
          light.es,
          light.rain,
          light.moon,
        ]
          .map(r2)
          .join(","),
        parts.ev,
        parts.car,
        parts.paint,
        lite,
      ].join("/")
    : "";
  const hit = keep ? cache.get(key) : undefined;
  if (hit) return hit;
  const { w, h } = phone ? FRAME.phone : FRAME.wide;
  const cam = camera(pose, w);
  const g = geometry(o);
  const look = looks(o);
  const B = new Builder(cam, look.roof, look.walls, o.panels, light);
  groundAndWalls(B, g);
  ROOFS_OF[o.style](B, g.eave);
  if (g.garage && !g.garage.carport) {
    garageInside(B, g.garage);
    garageShell(B, g.garage);
  } else if (g.garage) carport(B, g.garage);
  const K = kit(B, g.mount, g.battery);
  carScene(B, g, parts);
  gridScene(B, g);
  const mountWall = g.mount.inside ? null : g.mount.o[0] === 10 ? (B.wallItems.side ?? null) : B.garageSide;
  litExtras(B, K, g, mountWall);
  trees(B, look.garden, w, lite);

  // The garage stands against the house's side wall (x = 10). From that side it's drawn after the house; from the
  // other side (out west) before it, after the trees, so the house hides it. Its own parts keep their order.
  const west = cam.eye[0] < 10;
  const order = (l: number) => (west && l >= 2 && l < 6 ? -0.6 + (l - 2) * 0.05 : l);
  const shapes = B.items.sort((a, b) => order(a.layer) - order(b.layer) || b.depth - a.depth).flatMap((i) => i.shapes);

  // The light of the moment: night, rain and the warm ends of the day outside, the garage's own light inside.
  const L = light.sky;
  const shadeAmt = (1 - L) * 0.64 + L * (0.06 + 0.1 * light.cover + 0.14 * light.rain);
  const SH = mix(mix([96, 106, 126], [11, 18, 38], 1 - L), [44, 56, 80], light.rain * 0.5);
  const shadeCol = css(SH);
  const rim = L * clamp01(1 - light.es * 2.6) * (1 - 0.8 * light.cover) * 0.28;
  const lit = B.night;
  const baked = new Map<string, string>();
  const bake = (col: string | undefined, sh: Shape) => {
    if (!col || col === "none" || col.startsWith("url(") || sh.own) return col ?? "none";
    const key = `${col}|${sh.inside ? 1 : 0}${sh.roof ? 1 : 0}`;
    const hit = baked.get(key);
    if (hit) return hit;
    const cc = parseCol(col);
    if (!cc) return col;
    let c: Rgb = [cc[0], cc[1], cc[2]];
    if (sh.inside) c = mix(mix(c, SH, 0.18 + shadeAmt * 0.5), [255, 207, 138], lit * 0.22);
    else {
      c = mix(c, SH, shadeAmt);
      if (sh.roof && rim > 0.01) c = mix(c, [255, 154, 90], rim);
    }
    const out = cc.length > 3 ? `rgba(${c.map(Math.round).join(",")},${cc[3]})` : css(c);
    baked.set(key, out);
    return out;
  };

  // The sky's haze along the horizon, which the lawn's far edge and the far trees sink into.
  const hf = unit([cam.fwd[0], cam.fwd[1], 1e-9]);
  const h0 = cam.p(addk(cam.eye, hf, 5000))?.[1] ?? h / 2;
  const hor = css(light.horizon);
  let svg =
    `<defs><linearGradient id="lh-haze" gradientUnits="userSpaceOnUse" x1="0" y1="${n1(h0 - 70)}" x2="0" y2="${n1(h0 + 6)}">` +
    `<stop offset="0" stop-color="${hor}" stop-opacity="0"/><stop offset="1" stop-color="${hor}" stop-opacity=".7"/></linearGradient></defs>` +
    `<rect x="-600" y="${n1(h0 - 70)}" width="${w + 1200}" height="76" fill="url(#lh-haze)"/>`;
  const slots: Slot[] = [];
  const slot = (x: Slot) => {
    svg += `<g data-slot="${slots.length}"></g>`;
    slots.push(x);
  };
  const full = (fill: string, a: number) =>
    `<rect x="-600" y="-600" width="${w + 1200}" height="${h + 1200}" fill="${fill}" fill-opacity="${a.toFixed(3)}"/>`;
  const moon = cam.p([4, 6.5, g.eave + 1.0]);
  const moonA = light.moon * (1 - 0.8 * light.cover) * 0.4;
  let ci = 0;
  for (const s of shapes) {
    if (s.slot) {
      slot(s.slot);
      continue;
    }
    if (s.raw != null) {
      svg += s.raw;
      continue;
    }
    let clip = "";
    if (s.clip) {
      svg += `<clipPath id="lh-k${ci}"><path d="${s.clip}"/></clipPath>`;
      clip = ` clip-path="url(#lh-k${ci++})"`;
    }
    const op = s.opacity != null ? ` opacity="${s.opacity}"` : "";
    svg += s.stroke
      ? `<path d="${s.d}" fill="none" stroke="${bake(s.stroke, s)}" stroke-width="${s.width}" stroke-linecap="round"${op}${clip}/>`
      : `<path d="${s.d}" fill="${bake(s.fill, s)}"${s.seam ? ` stroke="${bake(s.fill, s)}" stroke-width="${s.seam}" stroke-linejoin="round"` : ""}${op}${clip}/>`;
    if (s.fill === "url(#lh-glass)") {
      // What a row of panels' glass shows: the sky's colour (more of it towards night), the warmth of making power and
      // a band of light crossing it (in its slot), wet in rain, the moon in it, then the light of the moment.
      svg += `<clipPath id="lh-k${ci}"><path d="${s.d}"/></clipPath><g clip-path="url(#lh-k${ci++})">${full(hor, 0.16 + 0.3 * (1 - L))}`;
      slot({ kind: "glass", cells: s.cells ?? "" });
      if (light.rain > 0.01) svg += full("#c8d4ea", 0.18 * light.rain * 0.9);
      if (moon && moonA > 0.01)
        svg += `<ellipse cx="${n1(moon[0])}" cy="${n1(moon[1])}" rx="92" ry="14" fill="url(#lh-moon)" opacity="${moonA.toFixed(2)}"/>`;
      svg += `${full(shadeCol, shadeAmt)}</g>`;
    }
    if (s.fill === "url(#lh-win)") {
      // A window darkens with the evening and lights up from inside: brighter low down, a blind shading its top, and a
      // soft spill of light on the wall around it. Rooms vary in how bright they are.
      svg += `<path d="${s.d}" fill="${shadeCol}" opacity="${shadeAmt.toFixed(2)}"/>`;
      if (lit > 0.01) {
        const k = s.win?.k ?? 1;
        svg += `<path d="${s.d}" fill="url(#lh-winlit)" opacity="${(lit * (0.55 + 0.45 * k)).toFixed(2)}"/><path d="${s.d}" fill="url(#lh-blind)" opacity="${lit.toFixed(2)}"/>`;
        if (s.win)
          svg += `<ellipse cx="${n1(s.win.x + s.win.w / 2)}" cy="${n1(s.win.y + s.win.h * 0.6)}" rx="${n1(s.win.w * 1.05)}" ry="${n1(s.win.h * 1.15)}" fill="url(#lh-spill)" opacity="${(lit * 0.75 * k).toFixed(2)}"/>`;
      }
    }
  }

  // The sheen lies along the slope as this camera sees it.
  const c0 = cam.p([5, 8, g.eave + 0.4]) ?? [w / 2, h / 2];
  const c1 = cam.p([5, 5, g.eave + 1.6]) ?? [w / 2, h / 2 - 1];
  const art: HouseArt = {
    w,
    h,
    svg,
    slots,
    kit: K,
    sheen: {
      x: c0[0] - 420,
      cx: c0[0],
      cy: c0[1],
      rot: (Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) * 180) / Math.PI + 90,
    },
  };
  if (keep) {
    cache.set(key, art);
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
  }
  return art;
}

// ------------------------------------------------------------------------------------------------- what moves over it

/** What the house shows at a moment, in its slots. */
export type HouseState = {
  /** The grid: W, buying positive. */
  grid: number | null;
  /** What the car's charging at (kW). */
  car: number;
  /** How hard the panels are working, of the array (0 to 1), and whether they are. */
  share: number;
  on: boolean;
  /** The battery: W, charging negative (as the inverter reports it), and its level (0 to 100). */
  battery: { w: number | null; level: number | null };
  /** For the power's comets to carry on where they were when it's drawn again (ms). */
  now: number;
};

/** The orange of the solar lines, the blue of charging, the amber of discharging (and selling), the car's teal, and
 * the violet of buying. */
const PV = "#ffb547";
const CHARGE = "#7d97ff";
const DRAIN = "#f2a65a";
const EVC = "#4fd1c5";
const IMPC = "#a3abff";

/** Power along a line: a soft glow under it, and comets running along it, more, longer and quicker as `f` rises. */
function flow(d: string, color: string, f: number, i: number, now: number) {
  if (!d) return "";
  const dur = 3.6 - 2.2 * f;
  const len = 4 + 7 * f;
  const n = f > 0.02 ? 1 + +(f > 0.25) + +(f > 0.5) + +(f > 0.75) : 0;
  const a = (0.12 + 0.45 * f).toFixed(2);
  let s = `<g style="--dur:${dur.toFixed(2)}s" fill="none" stroke="${color}" stroke-linecap="round" stroke-width="3.4"><path d="${d}" stroke-width="10.8" stroke-opacity="${a}" opacity=".35"/><path d="${d}" stroke-opacity="${a}"/>`;
  for (let k = 0; k < n; k++) {
    const phase = (now / 1000 / dur + k / 4 + i * 0.29) % 1;
    s += `<path class="roof-comet" d="${d}" pathLength="100" stroke-dasharray="${len.toFixed(1)} ${(100 - len).toFixed(1)}" style="animation-delay:-${(phase * dur).toFixed(3)}s"/>`;
  }
  return s + "</g>";
}

const reverse = (d: string) => (d ? `M${d.slice(1).split(" L").reverse().join(" L")}` : d);

/**
 * What moves, for one of the picture's slots: in a row of panels' glass, the warmth of making power, a band of light
 * crossing it and its cells glowing; along a rail, the power; on the battery and inverter, the power down the conduit
 * and in or out of the battery, and its level on its face (blue charging, amber discharging) with its lights.
 */
export function slotMarkup(art: HouseArt, slot: Slot, s: HouseState): string {
  const f = s.on ? clamp01(s.share) : 0;
  if (slot.kind === "glass") {
    if (!s.on) return "";
    let out = `<rect x="-600" y="-600" width="${art.w + 1200}" height="${art.h + 1200}" fill="${PV}" fill-opacity="${(0.03 + 0.2 * f).toFixed(3)}"/>`;
    if (f > 0.06)
      out +=
        `<g opacity="${(0.08 + 0.4 * f).toFixed(2)}"><g class="roof-sheen" style="animation-duration:${(10 - 5 * f).toFixed(1)}s">` +
        `<rect x="${n1(art.sheen.x)}" y="-300" width="108" height="${art.h + 600}" fill="url(#lh-sheen)" fill-opacity=".4" transform="rotate(${art.sheen.rot.toFixed(1)} ${n1(art.sheen.cx)} ${n1(art.sheen.cy)})"/></g></g>`;
    if (slot.cells)
      out += `<path d="${slot.cells}" fill="none" stroke="#ffd08a" stroke-width=".8" opacity="${(0.03 + 0.15 * f).toFixed(2)}"/>`;
    return out;
  }
  if (slot.kind === "rail") return s.on ? flow(slot.d, PV, f, slot.i, s.now) : "";
  if (slot.kind === "car") {
    const charging = s.car > 0.05;
    const pc = charging ? "#5ef0b0" : "#5b8cff";
    return (
      (charging ? flow(slot.flow, EVC, clamp01(s.car / 7), 7, s.now) : "") +
      (slot.port ? `<path d="${slot.port}" fill="${pc}" stroke="${pc}" stroke-width="4" stroke-opacity=".3"/>` : "")
    );
  }
  if (slot.kind === "drop" || slot.kind === "meter") {
    const gk = (s.grid ?? 0) / 1000;
    const flowing = Math.abs(gk) > 0.05;
    const col = gk > 0 ? IMPC : DRAIN;
    const gf = Math.max(0.15, clamp01(Math.abs(gk) / 5));
    if (slot.kind === "drop") return flowing ? flow(gk > 0 ? slot.d : reverse(slot.d), col, gf, 9, s.now) : "";
    const led = gk > 0.05 ? IMPC : gk < -0.05 ? DRAIN : "#4ade80";
    return (
      (flowing ? flow(gk > 0 ? slot.conduit : reverse(slot.conduit), col, gf, 10, s.now) : "") +
      (slot.led ? `<path class="house-pulse" d="${slot.led}" fill="${led}"/>` : "")
    );
  }
  const K = art.kit;
  if (!K?.shown) return "";
  let out = s.on ? flow(K.dc, PV, f, 3, s.now) : "";
  if (!K.battery) return out;
  // The inverter reports charging as negative.
  const b = s.battery.w == null ? 0 : -s.battery.w / 1000;
  const charging = b > 0.02;
  const draining = b < -0.02;
  if (charging || draining)
    out += flow(
      draining ? reverse(K.link) : K.link,
      charging ? CHARGE : DRAIN,
      Math.max(0.15, clamp01(Math.abs(b) / 5)),
      5,
      s.now,
    );
  if (s.battery.level == null) return out;
  const bar = K.bar(s.battery.level / 100);
  const col = draining ? DRAIN : CHARGE;
  out += `<path d="${bar.track}" fill="#1c2430" opacity=".85"/><path d="${bar.fill}" fill="${col}" stroke="${col}" stroke-width="6" stroke-opacity=".25"/><path d="${bar.fill}" fill="${col}"/>`;
  if (charging && bar.up)
    out += `<g style="--dur:1.8s" fill="none" stroke="#e3e9ff" stroke-width="3" stroke-linecap="round"><path class="roof-comet" d="${bar.up}" pathLength="100" stroke-dasharray="14 86" style="animation-delay:-${((s.now / 1000) % 1.8).toFixed(2)}s"/></g>`;
  out += `<path class="house-pulse" d="${bar.led}" fill="${col}"/><path d="${bar.status}" fill="#4ade80"/>`;
  return out;
}
