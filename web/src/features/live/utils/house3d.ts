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
 * never sorts behind it. Everything that stands still is one SVG string per camera and light (cached); what moves (the
 * power, the battery's level, the light over it all) is laid over it by houseOverlay().
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
export type Light = { dir: P3; el: number; L: number; warm: number; cover: number; sky: number; horizon: Rgb };

/** One shape in drawing order; `clip` keeps it to another outline (a shadow to the wall it falls on). */
type Shape = { d: string; fill?: string; stroke?: string; width?: number; opacity?: number; clip?: string };

/** The battery and inverter as drawn: their power lines, and the battery's level bar for a level (0 to 1). */
export type Kit = {
  battery: boolean;
  dc: string;
  link: string;
  bar: (level: number) => { track: string; fill: string; up: string; led: string; status: string };
};

export type HouseArt = {
  /** The picture's size (the sky's frame). */
  w: number;
  h: number;
  /** Everything that stands still, as SVG markup. */
  svg: string;
  /** All the panels' glass (what the glass shows is clipped to it), their cell gaps, and their rails. */
  glass: string;
  cells: string;
  rails: string[];
  /** Everything built, the roof faces, the windows and inside the garage: for the light over them. */
  built: string;
  roofs: string;
  windows: string;
  inside: string;
  kit: Kit | null;
  /** Where the sheen crosses the glass and the moon lies in it. */
  sheen: { x: number; cx: number; cy: number; rot: number };
  moon: P2;
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

// ------------------------------------------------------------------------------------------------- the light

/** The light from the sky when the sun's down or behind cloud: from overhead and a little towards the street. */
const SKYLIGHT = unit([0.35, 0.55, 0.76]);

/**
 * A colour in the light: brighter the more squarely its face meets the sun, warmer late in the day, darker and cooler
 * turned away. With the sun down, the soft light from the sky still tells the faces apart.
 */
function litRGB(c: Rgb, n: P3, sun: Light): Rgb {
  const dir = unit(lerp3(SKYLIGHT, sun.dir, sun.L));
  const str = 0.4 + 0.6 * sun.L;
  const lam = Math.max(0, dot(n, dir));
  const sky = 0.5 + 0.5 * n[2];
  const k = str * (0.7 * lam - 0.3 + 0.12 * sky);
  c = k >= 0 ? mix(c, [255, 251, 242], k * 0.6) : (c.map((v) => v * (1 + k)) as Rgb);
  c = mix(c, [255, 168, 104], sun.L * sun.warm * lam * 0.24);
  return mix(c, [104, 124, 170], str * (1 - lam) * 0.08);
}
const litColour = (fill: string, n: P3, sun: Light) => css(litRGB(rgb(fill), n, sun));

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
};

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
  return { storeys: o.storeys, raised, z0, eave, garage, mount, battery: o.batteries.length > 0 };
}

// ------------------------------------------------------------------------------------------------- the builder

type Item = { layer: number; depth: number; shapes: Shape[]; d?: string; pts?: P3[]; n?: P3 };

class Builder {
  items: Item[] = [];
  built: string[] = [];
  roofs: string[] = [];
  glass: string[] = [];
  cells: string[] = [];
  rails: string[] = [];
  windows: string[] = [];
  inside: string[] = [];
  /** Drawn in layers (the ground, trees, the house, what's in front of it), far to near within each. */
  layer = 0;
  /** The walls things hang on (front and side), each one draw item. */
  wallItems: Partial<Record<"front" | "side", Item>> = {};
  /** Every roof face's corners (for the shadows they cast), and their eaves (for the undersides). */
  roofPts: P3[] = [];
  eaves: Plane[] = [];
  /** The garage's outside wall, when the battery may hang on it. */
  garageSide: Item | null = null;
  /** Each fill's own colour before it's lit (the side shades a flat drawing bakes in go back to the face's). */
  base: Map<string, string>;
  panelsLeft: number;
  constructor(
    readonly cam: Cam,
    readonly roof: Roof,
    readonly walls: Finish,
    panels: number,
    readonly sun: Light,
  ) {
    this.panelsLeft = panels;
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
    const it = this.add(this.depthOf(pts), { d, fill: inside ? fill : this.light(fill, pts) }, ...extra);
    it.d = d;
    it.pts = pts;
    (inside ? this.inside : this.built).push(d);
    if (roof) this.roofs.push(d);
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
    if (opts.panels) extra.push(...this.panels(pl));
    const [a1, b1] = pl.ulim(1);
    if (opts.cap !== false) {
      extra.push({ d: cam.seg(pl.P(a1, 1), pl.P(b1, 1)), stroke: roof.cap, width: 4.6 });
      if (pl.lo > 0) extra.push({ d: cam.seg(pl.P(0, 0), pl.P(a1, 1)), stroke: roof.cap, width: 3.8 });
      if (pl.hi > 0) extra.push({ d: cam.seg(pl.P(pl.L, 0), pl.P(b1, 1)), stroke: roof.cap, width: 3.8 });
    }
    this.face(pl.outline(), fill, extra, true);
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
    this.glass.push(glass);
    this.cells.push(gaps);
    return [
      { d: shadows, fill: "#000000", opacity: 0.25 },
      { d: edges, fill: "#7d8693" },
      { d: frames, fill: "#c3cad4" },
      { d: glass, fill: "url(#lh-glass)" },
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
    this.windows.push(pane);
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
      { d: pane, fill: "url(#lh-win)" },
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
    B.built.push(d);
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
        [garage.x1 + 0.4, 16, 0.012],
        [garage.x0 - 0.1, 16, 0.012],
      ],
      "#dedbd3",
      1e5,
    );
  ground(
    [
      [4.55, 8, 0.013],
      [5.65, 8, 0.013],
      [5.65, 18, 0.013],
      [4.55, 18, 0.013],
    ],
    "#d9d5cb",
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
    );
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
const kitLayer = (M: Mount) => (M.inside ? 3 : M.o[0] === 10 ? 1 : 5);

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
  B.layer = kitLayer(M);
  const q = (u: number, o: number, z: number): P3 => addk(addk(addk(M.o, M.a, u), M.n, o), [0, 0, z]);
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
  if (K.battery)
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
    B.built.push(body);
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
    B.add(dep, ...shapes, ...faces);
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
  lite: boolean,
  keep = true,
): HouseArt {
  const key = keep
    ? [
        phone,
        houseKey(o),
        [...pose.eye, ...pose.at, pose.fov, pose.cx, pose.cy].map(r2).join(","),
        [...light.dir, light.el, light.L, light.warm, light.cover, light.sky, ...light.horizon].map(r2).join(","),
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
  const mountWall = g.mount.inside ? null : g.mount.o[0] === 10 ? (B.wallItems.side ?? null) : B.garageSide;
  litExtras(B, K, g, mountWall);
  trees(B, look.garden, w, lite);

  const shapes = B.items.sort((a, b) => a.layer - b.layer || b.depth - a.depth).flatMap((i) => i.shapes);
  // The sky's haze along the horizon, which the lawn's far edge and the far trees sink into.
  const hf = unit([cam.fwd[0], cam.fwd[1], 1e-9]);
  const h0 = cam.p(addk(cam.eye, hf, 5000))?.[1] ?? h / 2;
  const hor = css(light.horizon);
  let svg =
    `<defs><linearGradient id="lh-haze" gradientUnits="userSpaceOnUse" x1="0" y1="${n1(h0 - 70)}" x2="0" y2="${n1(h0 + 6)}">` +
    `<stop offset="0" stop-color="${hor}" stop-opacity="0"/><stop offset="1" stop-color="${hor}" stop-opacity=".7"/></linearGradient></defs>` +
    `<rect x="-600" y="${n1(h0 - 70)}" width="${w + 1200}" height="76" fill="url(#lh-haze)"/>`;
  let ci = 0;
  for (const s of shapes) {
    let clip = "";
    if (s.clip) {
      svg += `<clipPath id="lh-k${ci}"><path d="${s.clip}"/></clipPath>`;
      clip = ` clip-path="url(#lh-k${ci++})"`;
    }
    const op = s.opacity != null ? ` opacity="${s.opacity}"` : "";
    svg += s.stroke
      ? `<path d="${s.d}" fill="none" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round"${op}${clip}/>`
      : `<path d="${s.d}" fill="${s.fill ?? "none"}"${op}${clip}/>`;
  }

  // The sheen lies along the slope as this camera sees it; the moon sits low in the glass.
  const c0 = cam.p([5, 8, g.eave + 0.4]) ?? [w / 2, h / 2];
  const c1 = cam.p([5, 5, g.eave + 1.6]) ?? [w / 2, h / 2 - 1];
  const art: HouseArt = {
    w,
    h,
    svg,
    glass: B.glass.join(""),
    cells: B.cells.join(""),
    rails: B.rails,
    built: B.built.join(""),
    roofs: B.roofs.join(""),
    windows: B.windows.join(""),
    inside: B.inside.join(""),
    kit: K,
    sheen: {
      x: c0[0] - 420,
      cx: c0[0],
      cy: c0[1],
      rot: (Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) * 180) / Math.PI + 90,
    },
    moon: cam.p([4, 6.5, g.eave + 1.0]) ?? [w / 2, h / 2],
  };
  if (keep) {
    cache.set(key, art);
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
  }
  return art;
}

// ------------------------------------------------------------------------------------------------- what moves over it

/** What the house shows at a moment, over its picture. */
export type HouseState = {
  /** The sky's light (atmosphere.ts): the sun's height, the moon, the colour low in the sky, cloud and rain. */
  light: { es: number; moon: number; horizon: string; cover: number; rain: number };
  /** How hard the panels are working, of the array (0 to 1), and whether they are. */
  share: number;
  on: boolean;
  /** The battery: W, charging negative (as the inverter reports it), and its level (0 to 100). */
  battery: { w: number | null; level: number | null };
  /** For the power's comets to carry on where they were when it's drawn again (ms). */
  now: number;
};

/** The orange of the solar lines, the blue of charging, the amber of discharging. */
const PV = "#ffb547";
const CHARGE = "#7d97ff";
const DRAIN = "#f2a65a";

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

/**
 * What moves over the house, as SVG markup: what the glass shows (the sky's colour, the warmth of making power, a band
 * of light crossing it, wet in rain), the light over everything (night, rain, the warm ends of the day, the windows and
 * the garage lit from inside), and the power: along each row of panels, down the conduit to the inverter, and in or out
 * of the battery, whose level shows on its face (blue charging, amber discharging).
 */
export function houseOverlay(art: HouseArt, s: HouseState): string {
  const { light } = s;
  const f = s.on ? clamp01(s.share) : 0;
  const L = clamp01(light.es * 3 + 0.25);
  const shade = (1 - L) * 0.64 + L * (0.06 + 0.1 * light.cover + 0.14 * light.rain);
  const shadeCol = css(mix(mix([96, 106, 126], [11, 18, 38], 1 - L), [44, 56, 80], light.rain * 0.5));
  const rim = L * clamp01(1 - light.es * 2.6) * (1 - 0.8 * light.cover) * 0.28;
  const lit = clamp01(1 - L * 1.5) * 0.9;
  const W = art.w + 400;
  const H = art.h + 400;
  const full = (fill: string, a: number) =>
    `<rect x="-200" y="-200" width="${W}" height="${H}" fill="${fill}" fill-opacity="${a.toFixed(3)}"/>`;

  let out = `<g clip-path="url(#lh-glassclip)">${full(light.horizon, 0.16 + 0.3 * (1 - L))}`;
  if (s.on) out += full(PV, 0.03 + 0.2 * f);
  if (f > 0.06)
    out +=
      `<g opacity="${(0.08 + 0.4 * f).toFixed(2)}"><g class="roof-sheen" style="animation-duration:${(10 - 5 * f).toFixed(1)}s">` +
      `<rect x="${n1(art.sheen.x)}" y="-300" width="108" height="${art.h + 600}" fill="url(#lh-sheen)" fill-opacity=".4" transform="rotate(${art.sheen.rot.toFixed(1)} ${n1(art.sheen.cx)} ${n1(art.sheen.cy)})"/></g></g>`;
  if (light.rain > 0.01) out += full("#c8d4ea", 0.18 * light.rain * 0.9);
  out += `</g>`;
  if (s.on)
    out += `<path d="${art.cells}" fill="none" stroke="#ffd08a" stroke-width=".8" opacity="${(0.03 + 0.15 * f).toFixed(2)}"/>`;

  out += `<path d="${art.built}" fill="${shadeCol}" opacity="${shade.toFixed(3)}"/>`;
  if (art.inside)
    out += `<path d="${art.inside}" fill="${shadeCol}" opacity="${(0.18 + shade * 0.5).toFixed(2)}"/><path d="${art.inside}" fill="#ffcf8a" opacity="${(lit * 0.22).toFixed(2)}"/>`;
  if (rim > 0.01) out += `<path d="${art.roofs}" fill="#ff9a5a" opacity="${rim.toFixed(3)}"/>`;
  if (lit > 0.01) out += `<path d="${art.windows}" fill="#ffd27f" opacity="${lit.toFixed(3)}"/>`;
  const moon = light.moon * (1 - 0.8 * light.cover) * 0.4;
  if (moon > 0.01)
    out += `<ellipse cx="${n1(art.moon[0])}" cy="${n1(art.moon[1])}" rx="92" ry="14" fill="url(#lh-moon)" opacity="${moon.toFixed(2)}"/>`;

  if (s.on) art.rails.forEach((d, i) => (out += flow(d, PV, f, i, s.now)));
  const K = art.kit;
  if (!K) return out;
  if (s.on) out += flow(K.dc, PV, f, 3, s.now);
  if (!K.battery) return out;
  // The inverter reports charging as negative.
  const b = s.battery.w == null ? 0 : -s.battery.w / 1000;
  const charging = b > 0.02;
  const draining = b < -0.02;
  if (charging || draining) {
    let d = K.link;
    if (draining && d) d = `M${d.slice(1).split(" L").reverse().join(" L")}`;
    out += flow(d, charging ? CHARGE : DRAIN, Math.max(0.15, clamp01(Math.abs(b) / 5)), 5, s.now);
  }
  if (s.battery.level == null) return out;
  const bar = K.bar(s.battery.level / 100);
  const col = draining ? DRAIN : CHARGE;
  out += `<path d="${bar.track}" fill="#1c2430" opacity=".85"/><path d="${bar.fill}" fill="${col}" stroke="${col}" stroke-width="6" stroke-opacity=".25"/><path d="${bar.fill}" fill="${col}"/>`;
  if (charging && bar.up)
    out += `<g style="--dur:1.8s" fill="none" stroke="#e3e9ff" stroke-width="3" stroke-linecap="round"><path class="roof-comet" d="${bar.up}" pathLength="100" stroke-dasharray="14 86" style="animation-delay:-${((s.now / 1000) % 1.8).toFixed(2)}s"/></g>`;
  out += `<path class="house-pulse" d="${bar.led}" fill="${col}"/><path d="${bar.status}" fill="#4ade80"/>`;
  return out;
}
