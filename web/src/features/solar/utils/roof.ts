/*
 * The roof in Solar's sky: one Colorbond slope seen from eye level, so its ridge sits low across the sky like a horizon
 * and two rows of framed mono panels run across it. A perspective camera over a few scene units: x runs along the
 * ridge, y towards the street, z up; the slope rises from its gutter (v = 0) to the ridge (v = 1).
 *
 * Pure geometry, worked out once: every shape that never changes is folded into one SVG path per look (all the frames,
 * all the cell gaps, all the ribs...), so the drawing is a couple of dozen elements however many panels there are.
 * The picture is 1100 × 440; SolarRoof shows it anchored at its bottom left, so a narrower sky crops its far end.
 */

export const ROOF_W = 1100;
export const ROOF_H = 440;

type P3 = [number, number, number];
type P2 = [number, number];

/** The slope: its depth on the ground and its rise, in scene units (about metres). */
const D = 4.6;
const RH = 2.6;

/** A point on the slope: `u` along the ridge, `v` from gutter to ridge, `lift` off the sheet. */
const Q = (u: number, v: number, lift = 0): P3 => [u, D - D * v + lift * 0.5, RH * v + lift];

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: P3): P3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** A camera at `eye` looking at `at`, which lands at (cx, cy) in the picture. */
function camera(eye: P3, at: P3, fov: number, cx: number, cy: number) {
  const fwd = unit(sub(at, eye));
  const right = unit(cross(fwd, [0, 0, 1]));
  const up = cross(right, fwd);
  const focal = ROOF_W / 2 / Math.tan((fov * Math.PI) / 360);
  const depth = (p: P3) => dot(sub(p, eye), fwd);
  const p = (q: P3): P2 => {
    const d = sub(q, eye);
    const z = Math.max(dot(d, fwd), 0.05);
    return [cx + (focal * dot(d, right)) / z, cy - (focal * dot(d, up)) / z];
  };
  return { p, depth };
}

const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
const xy = (q: P2) => `${n1(q[0])} ${n1(q[1])}`;

export type RoofArt = {
  plane: string;
  ribsLight: string;
  ribsDark: string;
  shadows: string;
  edges: string;
  frames: string;
  frameTops: string;
  glass: string;
  gaps: string;
  diamonds: string;
  cap: string;
  capLine: string;
  capLight: string;
  rails: string[];
  /** Where the ridge is highest, for the roof's light to start from. */
  ridgeTop: number;
  /** The sheen's band: where it starts and how it's turned to lie along the slope. */
  sheen: { x: number; cx: number; cy: number; rot: number };
  /** Where the cloud shadows sit, and the moon's reflection. */
  clouds: { cx: number; cy: number; rx: number; ry: number }[];
  moon: P2;
};

const ROWS: [number, number][] = [
  [0.6, 0.86],
  [0.28, 0.56],
];
const COLS = 10;
const CW = 1.05;
const GAP = 0.05;
const COL0 = -0.4;
const U_LO = -12;
const U_HI = 30;
const LIFT = 0.035;
const THICK = 0.018;

function build(cy: number): RoofArt {
  const { p, depth } = camera([1, 10, 1.4], [5, 0, 2.4], 45, 560, cy);
  const poly = (pts: P3[]) => `M${pts.map((q) => xy(p(q))).join(" L")} Z`;
  const seg = (a: P3, b: P3) => `M${xy(p(a))} L${xy(p(b))}`;

  const panels: [number, number, number, number][] = [];
  for (const [v0, v1] of ROWS)
    for (let c = 0; c < COLS; c++) {
      const a = COL0 + c * (CW + GAP);
      panels.push([a, a + CW, v0, v1]);
    }
  const quad = ([a, b, v0, v1]: number[], lift = LIFT) => [
    Q(a, v0, lift),
    Q(b, v0, lift),
    Q(b, v1, lift),
    Q(a, v1, lift),
  ];
  const inset = ([a, b, v0, v1]: number[]) => [a + 0.03, b - 0.03, v0 + 0.012, v1 - 0.012];

  // Colorbond ribs, eave to ridge: a light edge and a dark one beside it.
  let ribsLight = "";
  let ribsDark = "";
  for (let u = U_LO; u < U_HI; u += 0.42) {
    ribsLight += seg(Q(u, 0), Q(u, 1));
    ribsDark += seg(Q(u + 0.05, 0), Q(u + 0.05, 1));
  }

  // Mono cells: six across, ten up each panel; silver gaps and the small diamonds where four cells meet.
  let gaps = "";
  let diamonds = "";
  for (const pn of panels) {
    const [a, b, v0, v1] = inset(pn);
    for (let i = 1; i < 6; i++) {
      const u = a + ((b - a) * i) / 6;
      gaps += seg(Q(u, v0, LIFT), Q(u, v1, LIFT));
    }
    for (let j = 1; j < 10; j++) {
      const v = v0 + ((v1 - v0) * j) / 10;
      gaps += seg(Q(a, v, LIFT), Q(b, v, LIFT));
    }
    for (let i = 1; i < 6; i++)
      for (let j = 1; j < 10; j++) {
        const q = Q(a + ((b - a) * i) / 6, v0 + ((v1 - v0) * j) / 10, LIFT);
        const [x, y] = p(q);
        const r = Math.max(0.35, 15 / depth(q));
        diamonds += `M${n1(x)} ${n1(y - r * 0.6)} L${n1(x + r)} ${n1(y)} L${n1(x)} ${n1(y + r * 0.6)} L${n1(x - r)} ${n1(y)} Z`;
      }
  }

  const mid = p(Q(4, 0.6));
  const lo = p(Q(4, 0.3));
  const hi = p(Q(4, 0.9));
  const c = p(Q(4, 0.55));
  const s = 40 / 26;
  return {
    plane: poly([Q(U_LO, 0), Q(U_HI, 0), Q(U_HI, 1), Q(U_LO, 1)]),
    ribsLight,
    ribsDark,
    // Each panel's shadow on the sheet, a touch down the slope.
    shadows: panels.map(([a, b, v0, v1]) => poly(quad([a, b, v0 - 0.018, v1 - 0.018], 0))).join(""),
    // The edge of each frame that faces you.
    edges: panels
      .map(([a, b, v0]) => poly([Q(a, v0, LIFT), Q(b, v0, LIFT), Q(b, v0, LIFT - THICK), Q(a, v0, LIFT - THICK)]))
      .join(""),
    frames: panels.map((pn) => poly(quad(pn))).join(""),
    frameTops: panels.map(([a, b, , v1]) => seg(Q(a, v1, LIFT), Q(b, v1, LIFT))).join(""),
    glass: panels.map((pn) => poly(quad(inset(pn)))).join(""),
    gaps,
    diamonds,
    cap: poly([Q(U_LO, 1), Q(U_HI, 1), Q(U_HI, 0.965, 0.05), Q(U_LO, 0.965, 0.05)]),
    capLine: seg(Q(U_LO, 1, 0.07), Q(U_HI, 1, 0.07)),
    capLight: seg(Q(U_LO, 1, 0.1), Q(U_HI, 1, 0.1)),
    // Each row's top rail, where the power runs: from the far end of the row along to the near edge and off it.
    rails: ROWS.map(
      ([, v1]) =>
        `M${xy(p(Q(COL0 + COLS * (CW + GAP), v1 + 0.02, LIFT / 2)))} L${xy(p(Q(COL0 - 1.6, v1 + 0.02, LIFT / 2)))}`,
    ),
    ridgeTop: Math.min(...[U_LO, 4, U_HI].map((u) => p(Q(u, 1))[1])),
    sheen: {
      x: mid[0] - 420,
      cx: mid[0],
      cy: mid[1],
      rot: (Math.atan2(hi[1] - lo[1], hi[0] - lo[0]) * 180) / Math.PI + 90,
    },
    clouds: [
      { cx: c[0] - 200 * s, cy: c[1] + 20 * s, rx: 260 * s, ry: 70 * s },
      { cx: c[0] + 200 * s, cy: c[1] - 10 * s, rx: 190 * s, ry: 55 * s },
    ],
    moon: p(Q(5.5, 0.62, LIFT)),
  };
}

let wide: RoofArt | undefined;
let phone: RoofArt | undefined;
/** The roof as drawn on a wide sky, or (sitting lower, under a phone's title) on a phone's. */
export function roofArt(onPhone: boolean): RoofArt {
  if (onPhone) return (phone ??= build(262));
  return (wide ??= build(282));
}
