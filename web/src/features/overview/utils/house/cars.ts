import type { ReactElement } from "react";
import { group, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import type { Spot } from "~/features/overview/utils/house/layout";

/*
 * Cars parked in the drawing. Each is drawn from its side view: the body's outline from the back of the car to the
 * front, and the cabin's (the glasshouse) above the belt line, both stretched across the car's width (the cabin a
 * little narrower), with wheels, tail lights and glass. Some popular models have outlines of their own, close to
 * the real car's length, width, height and roof line; every other car is drawn as a sedan, SUV or hatch.
 *
 * Cars park nose in, along y: the back of the car faces the street (+y) and its right side faces +x, which are the
 * sides the drawing shows. Outline points are [along, up]: along from the back (0) to the front (1), up in metres.
 */

export type CarBody =
  "model3" | "modelY" | "atto3" | "dolphin" | "seal" | "sealion7" | "ioniq5" | "sedan" | "suv" | "hatch";

type Pt = [along: number, up: number];

type Shape = {
  /** Length, width and height, in metres (a scene unit is about a metre). */
  size: [number, number, number];
  /** The body's outline, over the top from the back at the bottom to the front at the bottom. */
  body: Pt[];
  /** The cabin's, from where its back meets the belt line, over the roof, to the foot of the windscreen. */
  cabin: Pt[];
  /** Where the axles are, along the car, and the wheels' radius (m). */
  axles: [number, number];
  wheel: number;
  /** A glass roof (dark), rather than one in the body's colour. */
  glassRoof?: boolean;
  /** Tail lights: one bar across the back, or a light at each corner; and how high they sit (m). */
  lights: "bar" | "split";
  lightsAt: [number, number];
  roofRails?: boolean;
  /** A line pressed into the side (the Ioniq 5's diagonal). */
  crease?: [Pt, Pt];
};

const SHAPES: Record<CarBody, Shape> = {
  model3: {
    size: [4.72, 1.85, 1.44],
    body: [
      [0, 0.24],
      [0, 0.82],
      [0.02, 0.92],
      [0.13, 0.95],
      [0.75, 0.9],
      [0.93, 0.78],
      [0.99, 0.62],
      [1, 0.45],
      [1, 0.24],
    ],
    cabin: [
      [0.12, 0.95],
      [0.3, 1.3],
      [0.45, 1.44],
      [0.55, 1.43],
      [0.62, 1.32],
      [0.76, 0.9],
    ],
    axles: [0.18, 0.79],
    wheel: 0.35,
    glassRoof: true,
    lights: "split",
    lightsAt: [0.8, 0.9],
  },
  modelY: {
    size: [4.75, 1.92, 1.62],
    body: [
      [0, 0.22],
      [0, 0.88],
      [0.02, 0.95],
      [0.08, 0.98],
      [0.74, 0.98],
      [0.94, 0.86],
      [0.99, 0.72],
      [1, 0.55],
      [1, 0.22],
    ],
    cabin: [
      [0.06, 0.98],
      [0.1, 1.3],
      [0.22, 1.55],
      [0.42, 1.62],
      [0.55, 1.6],
      [0.62, 1.5],
      [0.75, 0.98],
    ],
    axles: [0.19, 0.8],
    wheel: 0.38,
    glassRoof: true,
    lights: "split",
    lightsAt: [0.86, 0.96],
  },
  atto3: {
    size: [4.455, 1.875, 1.615],
    body: [
      [0, 0.25],
      [0, 0.95],
      [0.02, 1.0],
      [0.74, 1.0],
      [0.93, 0.92],
      [0.99, 0.8],
      [1, 0.6],
      [1, 0.25],
    ],
    cabin: [
      [0.03, 1.0],
      [0.06, 1.48],
      [0.1, 1.58],
      [0.62, 1.6],
      [0.67, 1.5],
      [0.77, 1.0],
    ],
    axles: [0.19, 0.81],
    wheel: 0.36,
    lights: "bar",
    lightsAt: [0.9, 0.98],
    roofRails: true,
  },
  dolphin: {
    size: [4.29, 1.77, 1.57],
    body: [
      [0, 0.25],
      [0, 0.9],
      [0.02, 0.95],
      [0.74, 0.95],
      [0.94, 0.85],
      [1, 0.65],
      [1, 0.25],
    ],
    cabin: [
      [0.02, 0.95],
      [0.08, 1.45],
      [0.13, 1.56],
      [0.6, 1.56],
      [0.66, 1.45],
      [0.79, 0.95],
    ],
    axles: [0.18, 0.83],
    wheel: 0.34,
    lights: "bar",
    lightsAt: [0.84, 0.92],
  },
  seal: {
    size: [4.8, 1.875, 1.46],
    body: [
      [0, 0.24],
      [0, 0.82],
      [0.03, 0.9],
      [0.09, 0.92],
      [0.75, 0.85],
      [0.94, 0.72],
      [1, 0.55],
      [1, 0.22],
    ],
    cabin: [
      [0.1, 0.92],
      [0.28, 1.25],
      [0.42, 1.46],
      [0.56, 1.44],
      [0.63, 1.3],
      [0.77, 0.85],
    ],
    axles: [0.19, 0.79],
    wheel: 0.36,
    glassRoof: true,
    lights: "bar",
    lightsAt: [0.78, 0.86],
  },
  sealion7: {
    size: [4.83, 1.925, 1.62],
    body: [
      [0, 0.25],
      [0, 0.88],
      [0.03, 0.98],
      [0.75, 0.98],
      [0.94, 0.86],
      [1, 0.66],
      [1, 0.25],
    ],
    cabin: [
      [0.06, 0.98],
      [0.16, 1.3],
      [0.32, 1.57],
      [0.48, 1.62],
      [0.58, 1.6],
      [0.65, 1.48],
      [0.77, 0.98],
    ],
    axles: [0.18, 0.79],
    wheel: 0.38,
    glassRoof: true,
    lights: "bar",
    lightsAt: [0.86, 0.95],
  },
  ioniq5: {
    size: [4.635, 1.89, 1.605],
    body: [
      [0, 0.25],
      [0, 0.95],
      [0.01, 1.0],
      [0.78, 1.0],
      [0.95, 0.92],
      [1, 0.78],
      [1, 0.25],
    ],
    cabin: [
      [0.02, 1.0],
      [0.04, 1.55],
      [0.07, 1.6],
      [0.66, 1.6],
      [0.71, 1.5],
      [0.8, 1.0],
    ],
    axles: [0.16, 0.81],
    wheel: 0.38,
    glassRoof: true,
    lights: "split",
    lightsAt: [0.86, 0.98],
    crease: [
      [0.78, 0.48],
      [0.3, 0.82],
    ],
  },
  sedan: {
    size: [4.7, 1.85, 1.45],
    body: [
      [0, 0.25],
      [0, 0.85],
      [0.02, 0.92],
      [0.2, 0.94],
      [0.72, 0.9],
      [0.93, 0.8],
      [1, 0.6],
      [1, 0.25],
    ],
    cabin: [
      [0.2, 0.94],
      [0.32, 1.35],
      [0.42, 1.45],
      [0.6, 1.44],
      [0.67, 1.32],
      [0.76, 0.9],
    ],
    axles: [0.18, 0.8],
    wheel: 0.34,
    lights: "split",
    lightsAt: [0.78, 0.88],
  },
  suv: {
    size: [4.6, 1.88, 1.68],
    body: [
      [0, 0.28],
      [0, 0.98],
      [0.02, 1.02],
      [0.75, 1.02],
      [0.93, 0.95],
      [1, 0.8],
      [1, 0.28],
    ],
    cabin: [
      [0.04, 1.02],
      [0.08, 1.55],
      [0.12, 1.66],
      [0.62, 1.68],
      [0.68, 1.55],
      [0.77, 1.02],
    ],
    axles: [0.18, 0.8],
    wheel: 0.38,
    lights: "split",
    lightsAt: [0.9, 1.0],
    roofRails: true,
  },
  hatch: {
    size: [4.2, 1.8, 1.55],
    body: [
      [0, 0.25],
      [0, 0.9],
      [0.02, 0.95],
      [0.75, 0.95],
      [0.94, 0.85],
      [1, 0.65],
      [1, 0.25],
    ],
    cabin: [
      [0.03, 0.95],
      [0.1, 1.45],
      [0.15, 1.55],
      [0.6, 1.55],
      [0.67, 1.42],
      [0.78, 0.95],
    ],
    axles: [0.17, 0.83],
    wheel: 0.33,
    lights: "split",
    lightsAt: [0.84, 0.92],
  },
};

const TUMBLE = 0.1; // how much narrower the cabin is, each side (m)
const GLASS = "#27303c";
const GLASS_TOP = "#3a4452";
const TYRE = "#1c1d20";
const LIGHT = "#c3262e";

/** A colour mixed towards another: k 0 is the colour, 1 the other. */
function mix(hex: string, to: string, k: number): string {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(to)];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
}

/**
 * One outline stretched from x0 to x1: each edge as a face (only those facing up or towards the street, which the
 * drawing shows, from the front of the car back so nearer ones come last), then the right side.
 */
function extrude(
  pts: Pt[],
  x0: number,
  x1: number,
  at: (p: Pt) => [y: number, z: number],
  face: (normalUp: number, i: number) => string,
  sideFill: string,
): Kid[] {
  const out: Kid[] = [];
  for (let i = pts.length - 2; i >= 0; i--) {
    const [ya, za] = at(pts[i]);
    const [yb, zb] = at(pts[i + 1]);
    const [dy, dz] = [yb - ya, zb - za];
    // Facing out over the top (the outline runs back to front): towards the street or up is towards the viewer.
    if (dz - dy <= 0.001) continue;
    const len = Math.hypot(dy, dz) || 1;
    out.push(
      poly(
        [
          [x0, ya, za],
          [x1, ya, za],
          [x1, yb, zb],
          [x0, yb, zb],
        ],
        face(-dy / len, i),
        { stroke: "rgba(0,0,0,0.12)", strokeWidth: 0.5 },
      ),
    );
  }
  out.push(
    poly(
      pts.map((p) => [x1, ...at(p)] as P3),
      sideFill,
      { stroke: "rgba(0,0,0,0.18)", strokeWidth: 0.6 },
    ),
  );
  return out;
}

/** A wheel on the car's right side: a circle in the y-z plane, which the drawing turns into an ellipse. */
function wheel(x: number, y: number, r: number): Kid {
  const ring = (rr: number) =>
    Array.from({ length: 18 }, (_, k) => {
      const t = (k / 18) * Math.PI * 2;
      return [x, y + rr * Math.cos(t), r + rr * Math.sin(t)] as P3;
    });
  return group(poly(ring(r), TYRE), poly(ring(r * 0.62), "#8d939b"), poly(ring(r * 0.2), "#55595f"));
}

/** A car parked in a spot, in its shape and paint. */
export function drawCar(spot: Spot, body: CarBody, paint: string): ReactElement {
  const s = SHAPES[body];
  const [L, W] = s.size;
  const cx = (spot.x0 + spot.x1) / 2;
  const back = (spot.y0 + spot.y1) / 2 + L / 2; // the back of the car, towards the street
  const at = ([a, z]: Pt): [number, number] => [back - a * L, z];
  const [xl, xr] = [cx - W / 2, cx + W / 2];

  const top = mix(paint, "#ffffff", 0.16);
  const rear = mix(paint, "#000000", 0.12);
  const side = mix(paint, "#000000", 0.04);
  const out: Kid[] = [];

  // Its shadow on the ground.
  out.push(
    poly(
      [
        [xl - 0.12, back + 0.12, 0.01],
        [xr + 0.16, back + 0.12, 0.01],
        [xr + 0.16, back - L - 0.05, 0.01],
        [xl - 0.12, back - L - 0.05, 0.01],
      ],
      "rgba(0,0,0,0.2)",
    ),
  );

  // The body, its faces lit from above.
  out.push(...extrude(s.body, xl, xr, at, (up) => (up > 0.5 ? top : rear), side));

  // Tail lights across the back, or at its corners, wrapping a little round the side.
  const [l0, l1] = s.lightsAt;
  const lightFace = (a: number, b: number) =>
    poly(
      [
        [a, back + 0.005, l0],
        [b, back + 0.005, l0],
        [b, back + 0.005, l1],
        [a, back + 0.005, l1],
      ],
      LIGHT,
    );
  if (s.lights === "bar") out.push(lightFace(xl + 0.08, xr - 0.08));
  else out.push(lightFace(xl + 0.08, xl + 0.5), lightFace(xr - 0.5, xr - 0.08));
  out.push(
    poly(
      [
        [xr + 0.005, back, l0],
        [xr + 0.005, back - 0.18, l0 + 0.01],
        [xr + 0.005, back - 0.18, l1],
        [xr + 0.005, back, l1],
      ],
      LIGHT,
    ),
  );

  // A door line, and the Ioniq's crease.
  const beltAt = (a: number) => {
    const pts = s.body;
    for (let i = 0; i < pts.length - 1; i++) {
      const [p, q] = [pts[i], pts[i + 1]];
      if (p[0] <= a && a <= q[0] && q[0] > p[0]) return p[1] + ((a - p[0]) / (q[0] - p[0])) * (q[1] - p[1]);
    }
    return pts[1][1];
  };
  const door = (s.axles[0] + s.axles[1]) / 2;
  out.push(
    ln([xr + 0.01, ...at([door, s.wheel * 0.9])], [xr + 0.01, ...at([door, beltAt(door) - 0.04])], {
      stroke: "rgba(0,0,0,0.16)",
      strokeWidth: 0.8,
    }),
  );
  if (s.crease)
    out.push(
      ln([xr + 0.01, ...at(s.crease[0])], [xr + 0.01, ...at(s.crease[1])], {
        stroke: "rgba(0,0,0,0.2)",
        strokeWidth: 0.9,
      }),
    );

  // The cabin: glass at the back and sides, the roof glass or paint.
  const roof = s.glassRoof ? GLASS_TOP : top;
  out.push(...extrude(s.cabin, xl + TUMBLE, xr - TUMBLE, at, (up, i) => (up > 0.75 && i > 0 ? roof : GLASS), GLASS));
  // The pillar between the side windows, in the body's colour, and a glint on the glass.
  const roofLine = s.cabin.slice(1, -1);
  const mid = (s.cabin[0][0] + s.cabin[s.cabin.length - 1][0]) / 2;
  const roofAt = roofLine.reduce((a, p) => (Math.abs(p[0] - mid) < Math.abs(a[0] - mid) ? p : a), roofLine[0]);
  out.push(
    ln([xr - TUMBLE + 0.01, ...at([mid, s.cabin[0][1]])], [xr - TUMBLE + 0.01, ...at([mid, roofAt[1]])], {
      stroke: side,
      strokeWidth: 2.2,
    }),
    ln(
      [xr - TUMBLE + 0.01, ...at([mid + 0.04, s.cabin[0][1] + 0.12])],
      [xr - TUMBLE + 0.01, ...at([mid + 0.12, roofAt[1] - 0.12])],
      { stroke: "rgba(255,255,255,0.18)", strokeWidth: 1.2 },
    ),
  );
  if (s.roofRails) {
    const [a, b] = [s.cabin[2], s.cabin[s.cabin.length - 3]];
    for (const x of [xl + TUMBLE + 0.12, xr - TUMBLE - 0.12])
      out.push(
        ln([x, ...at([a[0], a[1] + 0.05])], [x, ...at([b[0], b[1] + 0.05])], { stroke: "#2c2f34", strokeWidth: 1.6 }),
      );
  }
  // A mirror at the foot of the windscreen.
  const [my, mz] = at([s.cabin[s.cabin.length - 1][0] - 0.03, s.cabin[s.cabin.length - 1][1] + 0.08]);
  out.push(
    poly(
      [
        [xr, my, mz],
        [xr + 0.16, my - 0.05, mz],
        [xr + 0.16, my - 0.05, mz + 0.12],
        [xr, my, mz + 0.14],
      ],
      side,
      { stroke: "rgba(0,0,0,0.2)", strokeWidth: 0.5 },
    ),
  );

  // The wheels on the side the drawing shows.
  for (const a of s.axles) out.push(wheel(xr + 0.01, back - a * L, s.wheel));

  return h("g", { className: "car" }, ...out);
}

/** The ground a spot covers, as a polygon on the drawing (for showing it on hover). */
export const spotOutline = (sp: Spot, z = 0.03): P3[] => [
  [sp.x0, sp.y0, z],
  [sp.x1, sp.y0, z],
  [sp.x1, sp.y1, z],
  [sp.x0, sp.y1, z],
];

/** Where a spot's label sits on the drawing: above its middle, at a car's height. */
export const spotTop = (sp: Spot) => I((sp.x0 + sp.x1) / 2, (sp.y0 + sp.y1) / 2, 2.3);
