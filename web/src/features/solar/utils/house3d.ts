import type { HouseOptions, HouseStyle } from "~/features/overview/utils/house/layout";
import { FINISHES, ROOFS, type Finish, type Roof } from "~/features/overview/utils/house/palette";
import { STYLES } from "~/features/overview/utils/house/scenery";

/*
 * Your house in Solar's sky, seen in perspective from low on its front corner: the end of its roof in front of you,
 * the street side with its panels running away across the sky. Built from Settings → Your house, as the Overview's
 * house is: its style's roof (a tiled gable or hip, corrugated or Colorbond iron, a skillion, a flat roof with its
 * panels on frames...), the roof's colour and the walls' finish (yours, or the style's own), one or two storeys, and
 * as many panels as you have.
 *
 * Scene units as the Overview house: x along the street (the house 0..10), y towards the street (its front wall at
 * y = 8), z up. Faces are drawn far to near; everything that never changes is worked out once per house as SVG paths.
 * The picture runs below the sky's frame (the wall, its windows and the garden) so SolarHouse can tilt up from the
 * house to its roof.
 */

type P3 = [number, number, number];
type P2 = [number, number];

/** One shape in drawing order. */
export type Shape = { d: string; fill?: string; stroke?: string; width?: number; opacity?: number };

export type HouseArt = {
  /** The picture's size: the sky's frame is its top `frame` units. */
  w: number;
  h: number;
  frame: number;
  shapes: Shape[];
  /** All the panels' glass (what the glass shows is clipped to it), their cell gaps, and their rails. */
  glass: string;
  cells: string;
  rails: string[];
  /** Everything built, the roof faces, and the windows: for the light over them. */
  built: string;
  roofs: string;
  windows: string;
  /** Where the sheen crosses the glass and the moon lies in it. */
  sheen: { x: number; cx: number; cy: number; rot: number };
  moon: P2;
};

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addk = (a: P3, b: P3, k = 1): P3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: P3): P3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();

const NEAR = 0.4;

/** A camera at `eye` looking at `at`, which lands at (cx, cy) in a picture `w` wide. */
function camera(eye: P3, at: P3, fov: number, cx: number, cy: number, w: number) {
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
  const p = (q: P3) => proj(cam(q));
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
  return { eye, p, poly, seg, depth };
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
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
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

/** The house's look: the roof's colours and the walls', yours over the style's own. */
function looks(o: HouseOptions): { roof: Roof; walls: Finish } {
  const own = STYLES[o.style].look;
  return { roof: ROOFS[o.roof ?? own.roof], walls: FINISHES[o.walls ?? own.walls] };
}

class Builder {
  items: { depth: number; shapes: Shape[] }[] = [];
  built: string[] = [];
  roofs: string[] = [];
  glass: string[] = [];
  cells: string[] = [];
  rails: string[] = [];
  windows: string[] = [];
  panelsLeft: number;
  constructor(
    readonly cam: Cam,
    readonly roof: Roof,
    readonly walls: Finish,
    panels: number,
  ) {
    this.panelsLeft = panels;
  }

  depthOf(pts: P3[]) {
    return pts.reduce((a, q) => a + this.cam.depth(q), 0) / pts.length;
  }
  facing(c: P3, n: P3) {
    return dot(sub(this.cam.eye, c), n) > 0;
  }
  add(depth: number, ...shapes: Shape[]) {
    this.items.push({ depth, shapes: shapes.filter((s) => s.d) });
  }
  face(pts: P3[], fill: string, extra: Shape[] = [], roof = false) {
    const d = this.cam.poly(pts);
    if (!d) return;
    this.add(this.depthOf(pts), { d, fill }, ...extra);
    this.built.push(d);
    if (roof) this.roofs.push(d);
  }

  /** A roof face with its material, caps, fascia and (if it carries them) panels. */
  roofFace(
    pl: Plane,
    fill: string,
    material: Material,
    opts: { panels?: boolean; cap?: boolean; fascia?: boolean } = {},
  ) {
    const mid = pl.P(pl.L / 2, 0.5);
    if (!this.facing(mid, pl.n)) return;
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
    if (opts.fascia !== false) extra.push({ d: cam.seg(pl.P(0, 0), pl.P(pl.L, 0)), stroke: FASCIA, width: 3.8 });
    this.face(pl.outline(), fill, extra, true);
  }

  /** Portrait panels in rows up a face, centred in each row as far as the face allows, until they're all placed. */
  panels(pl: Plane, rows?: [number, number][]): Shape[] {
    const { cam } = this;
    const out: Shape[] = [];
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
        const g = cam.poly([
          pl.P(u0 + 0.03, v0 + dv, lift),
          pl.P(u1 - 0.03, v0 + dv, lift),
          pl.P(u1 - 0.03, v1 - dv, lift),
          pl.P(u0 + 0.03, v1 - dv, lift),
        ]);
        glass += g;
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
    out.push(
      { d: shadows, fill: "#000000", opacity: 0.25 },
      { d: edges, fill: "#7d8693" },
      { d: frames, fill: "#c3cad4" },
      { d: glass, fill: "url(#GLASS)" },
      { d: gaps, stroke: "#c9d3e6", width: 0.7, opacity: 0.22 },
    );
    return out;
  }

  /** A box's faces that look at the camera, with lines across its walls in their material. */
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
      const c = pts.reduce((a, q) => addk(a, q, 0.25), [0, 0, 0] as P3);
      if (!this.facing(c, n)) continue;
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
      this.face(pts, fill, lines ? [{ d: lines, stroke: this.walls.line, width: 0.8 }] : []);
    }
  }

  /** A window on the street side (y fixed) or the right side (x fixed): frame, glass, mullion; lit at night. */
  window(at: "front" | "side", c: number, a0: number, a1: number, z0: number, z1: number, depthBias = -0.02) {
    const q = (a: number, z: number, out: number): P3 => (at === "front" ? [a, c + out, z] : [c + out, a, z]);
    const frame = this.cam.poly([
      q(a0 - 0.12, z0 - 0.12, 0.02),
      q(a1 + 0.12, z0 - 0.12, 0.02),
      q(a1 + 0.12, z1 + 0.12, 0.02),
      q(a0 - 0.12, z1 + 0.12, 0.02),
    ]);
    const pane = this.cam.poly([q(a0, z0, 0.03), q(a1, z0, 0.03), q(a1, z1, 0.03), q(a0, z1, 0.03)]);
    const mull = this.cam.seg(q((a0 + a1) / 2, z0, 0.04), q((a0 + a1) / 2, z1, 0.04));
    if (!pane) return;
    this.windows.push(pane);
    this.add(
      this.depthOf([q(a0, z0, 0), q(a1, z1, 0)]) + depthBias,
      { d: frame, fill: "#f4f1ea" },
      { d: pane, fill: "url(#WIN)" },
      { d: mull, stroke: "#f4f1ea", width: 2.2 },
    );
  }
}

const E = (storeys: number) => (storeys === 2 ? 5.5 : 2.6); // eave height

/** The walls, their windows and door, and the garden around them. */
function walls(B: Builder, storeys: number, raised = false) {
  const z0 = raised ? 0.9 : 0; // a Queenslander stands on stumps
  const W = E(storeys) + 0.1 + z0;
  const { walls: f } = B;
  // The lawn running out to the street and along the side, and a garden bed at the foot of the walls: under the
  // sky's light like everything built.
  const ground = (pts: P3[], fill: string, depth: number) => {
    const d = B.cam.poly(pts);
    if (!d) return;
    B.add(depth, { d, fill });
    B.built.push(d);
  };
  ground(
    [
      [-40, -30, 0],
      [60, -30, 0],
      [60, 40, 0],
      [-40, 40, 0],
    ],
    "#cdd8bf",
    1e6,
  );
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
  if (raised) B.box(0.2, 9.8, 0.2, 7.8, 0, z0, "#6b6f74", "#5c6065");
  B.box(0, 10, 0, 8, z0, W, f.face, f.side, undefined, true);
  B.add(
    B.depthOf([
      [0, 8, 0],
      [10, 8, 0.4],
    ]) - 0.01,
    {
      d: B.cam.poly([
        [0, 8.01, z0],
        [10, 8.01, z0],
        [10, 8.01, z0 + 0.35],
        [0, 8.01, z0 + 0.35],
      ]),
      fill: f.plinth,
    },
  );
  for (let s = 0; s < storeys; s++) {
    const b = z0 + s * 2.9;
    B.window("front", 8, 1.2, 3.2, b + 1.0, b + 2.15);
    B.window("front", 8, 6.6, 8.8, b + 1.0, b + 2.15);
    B.window("side", 10, 2.4, 4.6, b + 1.0, b + 2.15);
  }
  B.add(
    B.depthOf([
      [4.6, 8, z0],
      [5.6, 8, z0 + 2.1],
    ]) - 0.02,
    {
      d: B.cam.poly([
        [4.6, 8.03, z0],
        [5.6, 8.03, z0],
        [5.6, 8.03, z0 + 2.1],
        [4.6, 8.03, z0 + 2.1],
      ]),
      fill: "#6e5038",
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

/** The camera: low on the front right corner, looking along the street side of the roof. Higher for two storeys. */
function view(phone: boolean, storeys: number) {
  const up = storeys === 2 ? 2.9 : 0;
  return phone
    ? { w: 600, frame: 440, h: 700, cam: camera([13.5, 12.5, 3.6 + up], [4, 5, 3.4 + up], 55, 300, 285, 600) }
    : { w: 1100, frame: 480, h: 780, cam: camera([13.5, 12.5, 3.6 + up], [4, 5, 3.4 + up], 55, 520, 300, 1100) };
}

const cache = new Map<string, HouseArt>();

/** Your house as SolarHouse draws it, for a wide sky or a phone's. */
export function houseArt(o: HouseOptions, phone: boolean): HouseArt {
  const key = `${phone}|${o.style}|${o.storeys}|${o.roof}|${o.walls}|${o.panels}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { w, h, frame, cam } = view(phone, o.storeys);
  const { roof, walls: f } = looks(o);
  const B = new Builder(cam, roof, f, o.panels);
  walls(B, o.storeys, o.style === "queenslander" && o.storeys === 1);
  ROOFS_OF[o.style](B, E(o.storeys) + (o.style === "queenslander" && o.storeys === 1 ? 0.9 : 0));
  const shapes = B.items.sort((a, b) => b.depth - a.depth).flatMap((i) => i.shapes);
  const glass = B.glass.join("");
  // The sheen lies along the slope as this camera sees it; the moon sits low in the glass.
  const c0 = cam.p([5, 8, E(o.storeys) + 0.4]);
  const c1 = cam.p([5, 5, E(o.storeys) + 1.6]);
  const art: HouseArt = {
    w,
    h,
    frame,
    shapes,
    glass,
    cells: B.cells.join(""),
    rails: B.rails,
    built: B.built.join(""),
    roofs: B.roofs.join(""),
    windows: B.windows.join(""),
    sheen: {
      x: c0[0] - 420,
      cx: c0[0],
      cy: c0[1],
      rot: (Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) * 180) / Math.PI + 90,
    },
    moon: cam.p([4, 6.5, E(o.storeys) + 1.0]),
  };
  cache.set(key, art);
  return art;
}
