import { h, I, ln, poly, type Attrs, type Kid, type P3 } from "~/features/overview/utils/house/iso";

/*
 * Pieces the house styles and the shared scenery are drawn from: rectangles on the three visible planes,
 * garden, gradients and solar panels.
 */

/** What a house style draws: its walls (behind the garage), its roof and what sits on it (in front of the
 * garage, which tucks under the eaves), its lit windows at night, its own garden and front path. */
export type StyleParts = { house: Kid[]; roof: Kid[]; night: Kid[]; yard: Kid[]; paths: Kid[] };

export const WARM = "#ffd27f";

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

export const tree = (x: number, y: number, r = 20) => {
  const c = I(x, y, 2.4);
  return h(
    "g",
    {},
    ln([x, y, 0], [x, y, 1.5], { stroke: "#7a5a40", strokeWidth: 3.5 }),
    h("ellipse", { cx: c[0] + 3, cy: I(x, y, 0)[1] + 2, rx: r * 0.9, ry: r * 0.35, fill: "rgba(20,40,20,0.1)" }),
    h("circle", { cx: c[0], cy: c[1], r, fill: "#8fb07e" }),
    h("circle", { cx: c[0] + r * 0.28, cy: c[1] + r * 0.2, r: r * 0.62, fill: "#7a9d6a" }),
    h("circle", { cx: c[0] - r * 0.3, cy: c[1] - r * 0.3, r: r * 0.42, fill: "#a8c797" }),
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
      stroke: i % 2 ? "#7a9d6a" : "#8fb07e",
      strokeWidth: 4,
      strokeLinecap: "round",
    });
  });
  return h(
    "g",
    {},
    h("ellipse", { cx: I(x, y, 0)[0] + 3, cy: I(x, y, 0)[1] + 2, rx: 14, ry: 5, fill: "rgba(20,40,20,0.1)" }),
    ln([x, y, 0], [x, y, height], { stroke: "#9b8466", strokeWidth: 3.5 }),
    ...fronds,
  );
};

export const shrub = (x: number, y: number, r = 7, fill = "#9dbd8c") => {
  const c = I(x, y, 0.35);
  return h("circle", { cx: c[0], cy: c[1], r, fill });
};

/** Gradients the house's glass and panels use. */
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
      h("stop", { offset: "0", stopColor: "#9fe0ef" }),
      h("stop", { offset: "1", stopColor: "#4fb3d1" }),
    ),
  );

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
  const cell = { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 };
  return [
    poly([a, b, c, d], "url(#pvGrad)", { stroke: "#d9dee6", strokeWidth: 1 }),
    ln(at(a, b, 1 / 3), at(d, c, 1 / 3), cell),
    ln(at(a, b, 2 / 3), at(d, c, 2 / 3), cell),
    ln(at(a, d, 0.5), at(b, c, 0.5), cell),
  ];
}

/** A paned window on the street side: frame, glass, a mullion, and (`sill`) a sill below. */
export function frontWindow(y: number, x0: number, x1: number, z0: number, z1: number, o: { sill?: boolean } = {}) {
  return [
    front(y + 0.02, x0 - 0.14, x1 + 0.14, z0 - 0.14, z1 + 0.14, "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }),
    front(y + 0.03, x0, x1, z0, z1, "url(#glassL)"),
    ln([(x0 + x1) / 2, y + 0.04, z0], [(x0 + x1) / 2, y + 0.04, z1], { stroke: "#ffffff", strokeWidth: 2 }),
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
export const sideWindow = (x: number, y0: number, y1: number, z0: number, z1: number) => [
  side(x + 0.02, y0 - 0.14, y1 + 0.14, z0 - 0.14, z1 + 0.14, "#f4f1ea", { stroke: "#bfb8aa", strokeWidth: 0.8 }),
  side(x + 0.03, y0, y1, z0, z1, "url(#glassR)"),
  ln([x + 0.04, (y0 + y1) / 2, z0], [x + 0.04, (y0 + y1) / 2, z1], { stroke: "#f4f1ea", strokeWidth: 2 }),
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
    front(y + 0.03, x0, x1, z0, z1, WARM),
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
