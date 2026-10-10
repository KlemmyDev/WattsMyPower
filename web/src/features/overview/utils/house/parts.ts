import { h, I, ln, poly, type Attrs, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import type { Fence, Garden, Layout } from "~/features/overview/utils/house/layout";
import {
  FINISHES,
  ROOFS,
  type Finish,
  type Roof,
  type RoofColour,
  type WallFinish,
} from "~/features/overview/utils/house/palette";

/*
 * Pieces the house styles and the shared scenery are drawn from: rectangles on the three visible planes, walls in
 * their finish, windows, solar panels, garden, fences and gradients.
 */

/** What a house style draws: its walls (behind the garage), its roof and what sits on it (in front of the
 * garage, which tucks under the eaves), its lit windows at night, its own garden beds and front path, and where its
 * trees stand ([x, y, size]: drawn as the garden's kind of tree). */
export type StyleParts = {
  house: Kid[];
  roof: Kid[];
  night: Kid[];
  yard: Kid[];
  paths: Kid[];
  trees: [number, number, number][];
};

/** What a style looks like by default: its walls, roof colour, fence and trees, any of which can be swapped. */
export type StyleLook = { walls: WallFinish; roof: RoofColour; fence: Fence; garden: Garden };

/** A house style: how it's drawn, and how it looks unless the household chooses otherwise. */
export type Style = { draw: (l: Layout) => StyleParts; look: StyleLook };

/** The look a house is drawn in: its style's own, with the household's choices over it. */
export function lookOf(l: Layout, own: StyleLook): { walls: Finish; roof: Roof; fence: Fence; garden: Garden } {
  const o = l.options;
  return {
    walls: FINISHES[o.walls ?? own.walls],
    roof: ROOFS[o.roof ?? own.roof],
    fence: o.fence ?? own.fence,
    garden: o.garden ?? own.garden,
  };
}

export const WARM = "#ffd27f";
/** A lit window at night. */
export const LIT = "#f5c46e";

/** A flat rectangle on a wall facing the street (y fixed), from x0 to x1 and z0 to z1. */
export const front = (y: number, x0: number, x1: number, z0: number, z1: number, fill: string, o: Attrs = {}) =>
  poly(
    [
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
    ],
    fill,
    o,
  );

/** A flat rectangle on a wall facing right (x fixed), from y0 to y1 and z0 to z1. */
export const side = (x: number, y0: number, y1: number, z0: number, z1: number, fill: string, o: Attrs = {}) =>
  poly(
    [
      [x, y0, z0],
      [x, y1, z0],
      [x, y1, z1],
      [x, y0, z1],
    ],
    fill,
    o,
  );

/** A flat rectangle on the ground (or any level). */
export const flat = (x0: number, x1: number, y0: number, y1: number, z: number, fill: string, o: Attrs = {}) =>
  poly(
    [
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
    ],
    fill,
    o,
  );

// ------------------------------------------------------------------------------------------ walls in their finish

/** The lines a finish draws across a wall: courses of brick, board edges, or battens. `span(z)` gives the wall's
 * extent along it at height z (null above it); `up(u)` its top at u along it, for battens. */
function texture(
  f: Finish,
  at: (u: number, z: number) => P3,
  span: (z: number) => [number, number] | null,
  up: (u: number) => number,
  u0: number,
  u1: number,
  z0: number,
  z1: number,
): Kid[] {
  const out: Kid[] = [];
  if (f.material === "render") return out;
  if (f.material === "battens") {
    for (let u = u0 + 0.34; u < u1 - 0.05; u += 0.34)
      out.push(ln(at(u, z0), at(u, up(u)), { stroke: f.line, strokeWidth: 1.2 }));
    return out;
  }
  const step = f.material === "brick" ? 0.22 : 0.28;
  const stroke: Attrs = { stroke: f.line, strokeWidth: f.material === "brick" ? 0.8 : 1 };
  for (let z = z0 + step; z < z1 - 0.04; z += step) {
    const s = span(z);
    if (s) out.push(ln(at(s[0], z), at(s[1], z), stroke));
  }
  return out;
}

/** A wall facing the street in its finish: the face, its material's lines, and `plinth` (a darker course along the
 * ground) if asked. */
export function frontWall(f: Finish, y: number, x0: number, x1: number, z0: number, z1: number, plinth = false): Kid[] {
  return [
    front(y, x0, x1, z0, z1, f.face),
    ...texture(
      f,
      (u, z) => [u, y + 0.01, z],
      () => [x0, x1],
      () => z1,
      x0,
      x1,
      z0,
      z1,
    ),
    plinth && front(y + 0.01, x0, x1, z0, z0 + 0.35, f.plinth),
  ];
}

/** A wall facing right in its finish, its top running from z1 at y0 to `z1b` at y1 (a skillion's side). */
export function sideWall(
  f: Finish,
  x: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  o: { z1b?: number; plinth?: boolean } = {},
): Kid[] {
  const zb = o.z1b ?? z1;
  const top = (y: number) => z1 + ((y - y0) * (zb - z1)) / (y1 - y0);
  const span = (z: number): [number, number] | null => {
    if (z <= Math.min(z1, zb)) return [y0, y1];
    if (z >= Math.max(z1, zb)) return null;
    const y = y0 + ((z - z1) * (y1 - y0)) / (zb - z1);
    return z1 > zb ? [y0, y] : [y, y1];
  };
  return [
    poly(
      [
        [x, y0, z0],
        [x, y1, z0],
        [x, y1, zb],
        [x, y0, z1],
      ],
      f.side,
    ),
    ...texture(f, (u, z) => [x + 0.01, u, z], span, top, y0, y1, z0, Math.max(z1, zb)),
    o.plinth && side(x + 0.01, y0, y1, z0, z0 + 0.35, f.plinth),
  ];
}

/** A gable on a wall facing right: from y0 to y1 at z0 up to its peak at (yp, z1). */
export function sideGable(f: Finish, x: number, y0: number, y1: number, z0: number, yp: number, z1: number): Kid[] {
  const t = (z: number) => (z - z0) / (z1 - z0);
  return [
    poly(
      [
        [x, y0, z0],
        [x, y1, z0],
        [x, yp, z1],
      ],
      f.side,
    ),
    ...texture(
      f,
      (u, z) => [x + 0.01, u, z],
      (z) => [y0 + (yp - y0) * t(z), y1 - (y1 - yp) * t(z)],
      (u) => z0 + (z1 - z0) * (u < yp ? (u - y0) / (yp - y0) : (y1 - u) / (y1 - yp)),
      y0,
      y1,
      z0,
      z1,
    ),
  ];
}

/** A gable on a wall facing the street: from x0 to x1 at z0 up to its peak at (xp, z1). */
export function frontGable(
  f: Finish,
  y: number,
  x0: number,
  x1: number,
  z0: number,
  xp: number,
  z1: number,
  fill = f.face,
): Kid[] {
  const t = (z: number) => (z - z0) / (z1 - z0);
  return [
    poly(
      [
        [x0, y, z0],
        [x1, y, z0],
        [xp, y, z1],
      ],
      fill,
    ),
    ...texture(
      f,
      (u, z) => [u, y + 0.01, z],
      (z) => [x0 + (xp - x0) * t(z), x1 - (x1 - xp) * t(z)],
      (u) => z0 + (z1 - z0) * (u < xp ? (u - x0) / (xp - x0) : (x1 - u) / (x1 - xp)),
      x0,
      x1,
      z0,
      z1,
    ),
  ];
}

const SHADE = "#1b1f2a";
/** The shadow the eaves cast across the top of a wall, darkest right under them: on the street side (at `y`) or the
 * right side (at `x`), down from height z. */
export const eaveShadow = {
  front: (y: number, x0: number, x1: number, z: number, depth = 0.55): Kid[] => [
    front(y + 0.015, x0, x1, z - depth, z, SHADE, { fillOpacity: 0.07 }),
    front(y + 0.016, x0, x1, z - depth * 0.45, z, SHADE, { fillOpacity: 0.09 }),
  ],
  side: (x: number, y0: number, y1: number, z: number, depth = 0.55): Kid[] => [
    side(x + 0.015, y0, y1, z - depth, z, SHADE, { fillOpacity: 0.08 }),
    side(x + 0.016, y0, y1, z - depth * 0.45, z, SHADE, { fillOpacity: 0.1 }),
  ],
};

// ------------------------------------------------------------------------------------------ windows and doors

/** A paned window on the street side: frame, glass with a soft reflection, a mullion, and (`sill`) a sill below. */
export function frontWindow(
  y: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  o: { sill?: boolean; frame?: string; bars?: boolean } = {},
) {
  const frame = o.frame ?? "#ffffff";
  const xm = (x0 + x1) / 2;
  return [
    front(y + 0.02, x0 - 0.14, x1 + 0.14, z0 - 0.14, z1 + 0.14, frame, {
      stroke: "rgba(0,0,0,0.12)",
      strokeWidth: 0.8,
    }),
    front(y + 0.03, x0, x1, z0, z1, "url(#glassL)"),
    // the frame's shadow inside the top of the opening, and a sheen across the glass
    front(y + 0.035, x0, x1, z1 - 0.16, z1, "rgba(20,30,50,0.18)"),
    poly(
      [
        [x0 + (x1 - x0) * 0.12, y + 0.04, z1],
        [x0 + (x1 - x0) * 0.42, y + 0.04, z1],
        [x0 + (x1 - x0) * 0.12, y + 0.04, z0 + (z1 - z0) * 0.25],
      ],
      "#ffffff",
      { fillOpacity: 0.22 },
    ),
    ln([xm, y + 0.045, z0], [xm, y + 0.045, z1], { stroke: frame, strokeWidth: 2 }),
    o.bars && ln([x0, y + 0.045, (z0 + z1) / 2], [x1, y + 0.045, (z0 + z1) / 2], { stroke: frame, strokeWidth: 1.6 }),
    o.sill !== false &&
      poly(
        [
          [x0 - 0.25, y + 0.3, z0 - 0.23],
          [x1 + 0.25, y + 0.3, z0 - 0.23],
          [x1 + 0.25, y + 0.02, z0 - 0.14],
          [x0 - 0.25, y + 0.02, z0 - 0.14],
        ],
        "#e9e3d8",
      ),
  ];
}

/** A paned window on the right side. */
export const sideWindow = (x: number, y0: number, y1: number, z0: number, z1: number, frame = "#f4f1ea") => [
  side(x + 0.02, y0 - 0.14, y1 + 0.14, z0 - 0.14, z1 + 0.14, frame, { stroke: "rgba(0,0,0,0.14)", strokeWidth: 0.8 }),
  side(x + 0.03, y0, y1, z0, z1, "url(#glassR)"),
  side(x + 0.035, y0, y1, z1 - 0.16, z1, "rgba(20,30,50,0.2)"),
  ln([x + 0.04, (y0 + y1) / 2, z0], [x + 0.04, (y0 + y1) / 2, z1], { stroke: frame, strokeWidth: 2 }),
];

/** A window lit at night, and the glow it casts on the ground in front (`spill`). */
export function litFront(y: number, x0: number, x1: number, z0: number, z1: number, spill = false): Kid[] {
  return [
    spill &&
      poly(
        [
          [x0 - 0.3, y + 0.35, 0.03],
          [x1 + 0.3, y + 0.35, 0.03],
          [x1 + 1.3, y + 2.3, 0.03],
          [x0 - 0.5, y + 2.3, 0.03],
        ],
        WARM,
        { fillOpacity: 0.16 },
      ),
    front(y + 0.05, x0, x1, z0, z1, WARM),
  ];
}

/** A porch light: a little lamp on a wall facing the street, and its glow at night. */
export const porchLight = (p: P3) => {
  const wl = I(...p);
  return {
    lamp: [
      h("rect", { x: wl[0] - 2.5, y: wl[1] - 4, width: 5, height: 8, rx: 1.5, fill: "#2b2b2b" }),
      h("circle", { cx: wl[0], cy: wl[1] + 1, r: 1.5, fill: "#ffd27a" }),
    ],
    glow: [
      h("circle", { cx: wl[0], cy: wl[1] + 4, r: 26, fill: WARM, fillOpacity: 0.3 }),
      h("circle", { cx: wl[0], cy: wl[1] + 1, r: 3, fill: "#fff3cf" }),
    ],
  };
};

/** The electricity meter box on a wall facing the street. */
export const meterBox = (y: number, x0: number, z0: number) =>
  front(y + 0.02, x0, x0 + 0.5, z0, z0 + 0.75, "#ececec", { stroke: "#a9a9a9", strokeWidth: 0.8 });

// ------------------------------------------------------------------------------------------ solar panels

/**
 * A solar panel between four corners (in drawing order), with the cell lines across it: a third and two
 * thirds along `a`→`b`, and halfway along `a`→`d`.
 */
export function panel(a: P3, b: P3, c: P3, d: P3): Kid[] {
  const at = (p: P3, q: P3, t: number): P3 => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    (p[2] ?? 0) + ((q[2] ?? 0) - (p[2] ?? 0)) * t,
  ];
  const cell = { stroke: "rgba(255,255,255,0.13)", strokeWidth: 0.6 };
  return [
    poly([a, b, c, d], "url(#pvGrad)", { stroke: "#dfe4ea", strokeWidth: 0.9 }),
    ln(at(a, b, 1 / 3), at(d, c, 1 / 3), cell),
    ln(at(a, b, 2 / 3), at(d, c, 2 / 3), cell),
    ln(at(a, d, 0.5), at(b, c, 0.5), cell),
  ];
}

/** A roof's face: the point at u along it and v down it (from its top edge), just above the roof. */
export type Plane = (u: number, v: number) => P3;
/** A row of panels on a roof face: from u0 to u1 along it, v0 to v1 down it. */
export type PanelRow = { u0: number; u1: number; v0: number; v1: number };

/** Panels a solar panel is wide, and the gap between them. */
export const PANEL_W = 1.05;
const PANEL_GAP = 0.07;

/**
 * Up to `n` panels in rows on a roof face, portrait (PANEL_W across, the row's depth down the slope): filling the
 * rows in the order given, each row's panels centred in it. Returns what's drawn, and how many.
 */
export function panelRows(at: Plane, rows: PanelRow[], n: number, w = PANEL_W): { kids: Kid[]; placed: number } {
  const kids: Kid[] = [];
  let left = n;
  for (const r of rows) {
    if (left <= 0) break;
    const fit = Math.floor((r.u1 - r.u0 + PANEL_GAP) / (w + PANEL_GAP));
    const k = Math.min(fit, left);
    if (k <= 0) continue;
    const start = (r.u0 + r.u1) / 2 - (k * w + (k - 1) * PANEL_GAP) / 2;
    for (let i = 0; i < k; i++) {
      const u = start + i * (w + PANEL_GAP);
      kids.push(...panel(at(u, r.v1), at(u + w, r.v1), at(u + w, r.v0), at(u, r.v0)));
    }
    left -= k;
  }
  return { kids, placed: n - left };
}

/** Rows down a roof face from `v0` to `v1`, each `depth` deep, the face's width at v given by `span(v)` (narrower
 * towards a hip), so as many rows as fit. */
export function rowsDown(
  v0: number,
  v1: number,
  depth: number,
  span: (v: number) => [number, number],
  gap = 0.1,
): PanelRow[] {
  const rows: PanelRow[] = [];
  for (let v = v0; v + depth <= v1 + 1e-6; v += depth + gap) {
    const [a0, a1] = span(v); // narrowest at a row's top edge, on a hip
    const [b0, b1] = span(v + depth);
    rows.push({ u0: Math.max(a0, b0), u1: Math.min(a1, b1), v0: v, v1: v + depth });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------ the garden

/** A round, leafy tree, lit from the front. */
export const tree = (x: number, y: number, r = 20) => {
  const c = I(x, y, 2.4);
  return h(
    "g",
    {},
    h("ellipse", {
      cx: c[0] + r * 0.5,
      cy: I(x, y, 0)[1] + 2,
      rx: r * 1.05,
      ry: r * 0.36,
      fill: "rgba(20,40,20,0.12)",
    }),
    ln([x, y, 0], [x, y, 1.5], { stroke: "#7a5a40", strokeWidth: 3.5 }),
    h("circle", { cx: c[0], cy: c[1], r, fill: "#86a874" }),
    h("circle", { cx: c[0] + r * 0.3, cy: c[1] + r * 0.22, r: r * 0.66, fill: "#739762" }),
    h("circle", { cx: c[0] - r * 0.32, cy: c[1] - r * 0.28, r: r * 0.5, fill: "#a2c290" }),
    h("circle", { cx: c[0] - r * 0.42, cy: c[1] - r * 0.42, r: r * 0.2, fill: "#bcd6aa" }),
  );
};

/** A gum tree: a pale, crooked trunk and loose clumps of grey-green leaves. */
export const gum = (x: number, y: number, r = 20) => {
  const s = r / 20;
  const b = I(x, y, 0);
  const t = I(x, y, 3.1 * s);
  const clumps: [number, number, number, string][] = [
    [-14, -4, 11, "#8fa58a"],
    [10, -10, 12, "#9db497"],
    [-2, -20, 12, "#a9bfa2"],
    [16, 4, 9, "#7f9779"],
    [-10, 8, 8, "#869e80"],
  ];
  return h(
    "g",
    {},
    h("ellipse", { cx: b[0] + 10 * s, cy: b[1] + 2, rx: 22 * s, ry: 7 * s, fill: "rgba(20,40,20,0.12)" }),
    h("path", {
      d: `M${b[0]} ${b[1]} C ${b[0] - 3 * s} ${b[1] - 25 * s}, ${t[0] + 5 * s} ${t[1] + 30 * s}, ${t[0]} ${t[1] + 8 * s}`,
      fill: "none",
      stroke: "#e6dfd2",
      strokeWidth: 4 * s,
      strokeLinecap: "round",
    }),
    h("path", {
      d: `M${t[0] + 1 * s} ${t[1] + 20 * s} Q ${t[0] + 9 * s} ${t[1] + 10 * s} ${t[0] + 12 * s} ${t[1] + 2 * s}`,
      fill: "none",
      stroke: "#d8cfbf",
      strokeWidth: 2.2 * s,
      strokeLinecap: "round",
    }),
    ...clumps.map(([dx, dy, cr, fill]) => h("circle", { cx: t[0] + dx * s, cy: t[1] + dy * s, r: cr * s, fill })),
  );
};

/** A tall, slim palm. */
export const palm = (x: number, y: number, height = 4.2) => {
  const top = I(x, y, height);
  const fronds = [-150, -110, -70, -30, 10, 50, 200, 160].map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    const len = 22 + (i % 3) * 4;
    const ex = top[0] + Math.cos(r) * len;
    const ey = top[1] + Math.sin(r) * len * 0.55 + 6;
    return h("path", {
      d: `M${top[0]} ${top[1]} Q ${(top[0] + ex) / 2} ${Math.min(top[1], ey) - 8} ${ex} ${ey}`,
      fill: "none",
      stroke: i % 2 ? "#6f9560" : "#86ab73",
      strokeWidth: 4,
      strokeLinecap: "round",
    });
  });
  return h(
    "g",
    {},
    h("ellipse", { cx: I(x, y, 0)[0] + 8, cy: I(x, y, 0)[1] + 2, rx: 16, ry: 5, fill: "rgba(20,40,20,0.12)" }),
    ln([x, y, 0], [x, y, height], { stroke: "#9b8466", strokeWidth: 3.5 }),
    ...fronds,
  );
};

/** A tree of the garden's kind, at [x, y] and about `r` across; none in a minimal garden. */
export function gardenTree(kind: Garden, x: number, y: number, r: number): Kid {
  if (kind === "minimal") return null;
  if (kind === "native") return gum(x, y, r);
  if (kind === "tropical") return palm(x, y, 3.4 + r / 12);
  return tree(x, y, r);
}

export const shrub = (x: number, y: number, r = 7, fill = "#9dbd8c") => {
  const c = I(x, y, 0.35);
  return h(
    "g",
    {},
    h("circle", { cx: c[0], cy: c[1], r, fill }),
    h("circle", { cx: c[0] - r * 0.3, cy: c[1] - r * 0.3, r: r * 0.45, fill: "#ffffff", fillOpacity: 0.16 }),
  );
};

/**
 * A fence along the street at `y`, from x0 to x1 with a gap for the gate: white pickets, dark slats (as steel
 * fences come), or a clipped hedge.
 */
export function fence(kind: Fence, y: number, x0: number, x1: number, gate: [number, number]): Kid[] {
  const out: Kid[] = [];
  const runs = [
    [x0, gate[0] - 0.1],
    [gate[1] + 0.1, x1],
  ].filter(([a, b]) => b - a > 0.3);
  for (const [a, b] of runs) {
    if (kind === "picket") {
      out.push(ln([a, y, 0.55], [b, y, 0.55], { stroke: "#fbf7ef", strokeWidth: 1.6 }));
      for (let x = a; x <= b; x += 0.28) out.push(ln([x, y, 0], [x, y, 0.85], { stroke: "#fbf7ef", strokeWidth: 1.8 }));
    } else if (kind === "slat") {
      out.push(front(y, a, b, 0, 1.1, "#4a4f57"));
      for (let z = 0.15; z < 1.1; z += 0.16)
        out.push(ln([a, y + 0.01, z], [b, y + 0.01, z], { stroke: "#5d636c", strokeWidth: 1 }));
      for (let x = a; x <= b + 0.01; x += 2.2)
        out.push(ln([x, y + 0.02, 0], [x, y + 0.02, 1.2], { stroke: "#363a40", strokeWidth: 2.2 }));
    } else if (kind === "hedge") {
      out.push(
        poly(
          [
            [a, y + 0.4, 0],
            [b, y + 0.4, 0],
            [b, y + 0.4, 0.9],
            [a, y + 0.4, 0.9],
          ],
          "#7d9f6b",
        ),
        flat(a, b, y - 0.2, y + 0.4, 0.9, "#97b984"),
      );
      for (let x = a + 0.3; x < b; x += 0.55) {
        const c = I(x, y + 0.4, 0.88);
        out.push(h("circle", { cx: c[0], cy: c[1], r: 4.5, fill: "#97b984" }));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ gradients

/** Gradients the house's glass, panels and pool use. */
export const defs = () =>
  h(
    "defs",
    {},
    h(
      "linearGradient",
      { id: "pvGrad", x1: 0, y1: 0, x2: 1, y2: 1 },
      h("stop", { offset: "0", stopColor: "#2c4170" }),
      h("stop", { offset: "0.35", stopColor: "#5a79ad" }),
      h("stop", { offset: "0.5", stopColor: "#23365e" }),
      h("stop", { offset: "1", stopColor: "#16223d" }),
    ),
    h(
      "linearGradient",
      { id: "glassL", x1: 0, y1: 0, x2: 1, y2: 1 },
      h("stop", { offset: "0", stopColor: "#d7e6f7" }),
      h("stop", { offset: "0.45", stopColor: "#a9c1de" }),
      h("stop", { offset: "1", stopColor: "#8aa6c9" }),
    ),
    h(
      "linearGradient",
      { id: "glassR", x1: 0, y1: 0, x2: 1, y2: 1 },
      h("stop", { offset: "0", stopColor: "#9fb6d3" }),
      h("stop", { offset: "1", stopColor: "#6f8bb0" }),
    ),
    h(
      "linearGradient",
      { id: "glassDark", x1: 0, y1: 0, x2: 1, y2: 1 },
      h("stop", { offset: "0", stopColor: "#8ea9c8" }),
      h("stop", { offset: "0.5", stopColor: "#5b7598" }),
      h("stop", { offset: "1", stopColor: "#3f5675" }),
    ),
    h(
      "linearGradient",
      { id: "pool", x1: 0, y1: 0, x2: 1, y2: 1 },
      h("stop", { offset: "0", stopColor: "#a6e4f2" }),
      h("stop", { offset: "1", stopColor: "#45a9cc" }),
    ),
  );
