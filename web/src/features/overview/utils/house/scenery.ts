import type { ReactElement } from "react";
import { box, group, h, I, ln, poly, type Attrs, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { houseKey, type Layout } from "~/features/overview/utils/house/layout";

/*
 * The parts of the drawing that don't move: ground, house, garage, roof panels, yard, and the overlays
 * for wet ground and night. Built once for each house layout (Settings → System → Your house) and
 * reused for every render. The batteries, inverters and charger are drawn by HouseScene, as their
 * lights and gauges follow the readings.
 */

const tree = (x: number, y: number, r = 20) => {
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

const shrub = (x: number, y: number) => {
  const c = I(x, y, 0.35);
  return h("circle", { cx: c[0], cy: c[1], r: 7, fill: "#9dbd8c" });
};

/** A flat rectangle on a wall facing the street (y fixed), from x0 to x1 and z0 to z1. */
const front = (y: number, x0: number, x1: number, z0: number, z1: number, fill: string, o: Attrs = {}) =>
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
const side = (x: number, y0: number, y1: number, z0: number, z1: number, fill: string, o: Attrs = {}) =>
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

/** A flat rectangle on the ground. */
const flat = (x0: number, x1: number, y0: number, y1: number, z: number, fill: string, o: Attrs = {}) =>
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

/** The street-facing windows: x ranges along the front, on each floor. */
const windows = (l: Layout): [x0: number, x1: number, z: number][] => [
  [1.4, 3.4, 0],
  [7.4, 9.2, 0],
  ...(l.options.storeys === 2
    ? ([
        [1.4, 3.4, 4],
        [4.9, 6.7, 4],
        [7.4, 9.2, 4],
      ] as [number, number, number][])
    : []),
];

/** The right side's windows: z offset of each floor that has one. */
const sideWindows = (l: Layout): number[] => [...(l.sideWindow ? [0] : []), ...(l.options.storeys === 2 ? [4] : [])];

function build(l: Layout) {
  const { eave, ridge, wallTop, garage: g, ground: gr } = l;
  /** A point on the front roof plane: u along the ridge, v down the slope (0..1). */
  const PV = (u: number, v: number): P3 => [u, 4 + 4.6 * v, ridge - (ridge - eave) * v];
  /** Raise a point just off the roof so panels sit on top of it. */
  const lift = (p: P3): P3 => [p[0], p[1] - 0.05, (p[2] ?? 0) + 0.12];

  const ground: Kid[] = [];
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const yard: Kid[] = [];

  ground.push(
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
    ),
  );
  ground.push(...box(gr.x0, gr.x1, gr.y0, gr.y1, -0.5, 0, "#e3e9da", "#c3ccb7", "#d2dac6"));
  // Paving: a driveway beside the house, or in front of the garage, with its edge showing at the ground's sides.
  const [dx0, dx1, dy0] = g ? [g.x0 + 0.2, g.x1 - 0.2, g.y1] : [11, gr.x1, gr.y0];
  ground.push(flat(dx0, dx1, dy0, gr.y1, 0.01, "#ebeae5"));
  if (dx1 >= gr.x1) ground.push(side(gr.x1, dy0, gr.y1, -0.5, 0, "#cfcdc6"));
  ground.push(front(gr.y1, dx0, dx1, -0.5, 0, "#dcdad3"));
  if (!g)
    for (const yy of [1.0, 7.0])
      ground.push(ln([11.3, yy, 0.02], [gr.x1 - 0.3, yy, 0.02], { stroke: "rgba(0,0,0,0.06)", strokeWidth: 1.5 }));
  ground.push(flat(5.2, 6.4, 8, gr.y1, 0.01, "#ebeae5")); // the path to the front door
  ground.push(
    poly(
      [
        [0, 8, 0.02],
        [10, 8, 0.02],
        [10.6, 10.4, 0.02],
        [0.6, 10.4, 0.02],
      ],
      "rgba(30,40,30,0.08)",
    ),
  );

  // back tree, power pole, back roof, walls, windows, door, meter
  house.push(tree(-1.2, 2.2, 26));
  {
    const b = I(-2.2, 7, 0);
    house.push(h("ellipse", { cx: b[0] + 4, cy: b[1] + 1, rx: 8, ry: 3, fill: "rgba(0,0,0,0.12)" }));
  }
  house.push(
    ln([-1.5, 9.7, 0], [-1.5, 9.7, 8.2], { stroke: "#7b6652", strokeWidth: 4.5 }),
    ln([-1.5, 8.8, 7.6], [-1.5, 10.6, 7.6], { stroke: "#7b6652", strokeWidth: 3 }),
  );
  house.push(
    poly(
      [
        [-0.4, 4, ridge],
        [10.4, 4, ridge],
        [10.4, -0.6, eave],
        [-0.4, -0.6, eave],
      ],
      "#353a42",
    ),
  );
  house.push(
    side(10, 0, 8, 0, wallTop, "#ddd6ca"),
    poly(
      [
        [10, 0, wallTop],
        [10, 8, wallTop],
        [10, 4, ridge],
      ],
      "#d6cfc2",
    ),
  );
  house.push(front(8, 0, 10, 0, wallTop, "#f6f2eb"));
  house.push(front(8.01, 0, 10, 0, 0.35, "#d8d2c6"), side(10.01, 0, 8, 0, 0.35, "#c2bbad"));
  if (l.options.storeys === 2)
    house.push(
      front(8.01, 0, 10, 4.45, 4.6, "#e7e1d6"), // the floor band between storeys
      side(10.01, 0, 8, 4.45, 4.6, "#cfc8bb"),
    );
  for (const [x0, x1, z] of windows(l)) {
    house.push(
      front(8.02, x0 - 0.14, x1 + 0.14, z + 1.64, z + 3.76, "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }),
    );
    house.push(front(8.03, x0, x1, z + 1.78, z + 3.62, "url(#glassL)"));
    house.push(
      ln([(x0 + x1) / 2, 8.04, z + 1.78], [(x0 + x1) / 2, 8.04, z + 3.62], { stroke: "#ffffff", strokeWidth: 2 }),
    );
    house.push(
      poly(
        [
          [x0 - 0.25, 8.3, z + 1.55],
          [x1 + 0.25, 8.3, z + 1.55],
          [x1 + 0.25, 8.02, z + 1.64],
          [x0 - 0.25, 8.02, z + 1.64],
        ],
        "#e9e3d8",
      ),
    );
  }
  house.push(front(8.02, 5.1, 6.5, 0, 3.25, "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }));
  house.push(front(8.03, 5.25, 6.35, 0, 3.1, "#6e5038"));
  {
    const dh = I(6.15, 8.04, 1.5);
    house.push(h("circle", { cx: dh[0], cy: dh[1], r: 1.8, fill: "#e0c48a" }));
  }
  house.push(front(8.03, 0.6, 1.2, 2.7, 3.55, "#ececec", { stroke: "#a9a9a9", strokeWidth: 0.8 }));
  for (const z of sideWindows(l)) {
    house.push(side(10.02, 1.26, 3.54, z + 1.64, z + 3.76, "#f4f1ea", { stroke: "#bfb8aa", strokeWidth: 0.8 }));
    house.push(side(10.03, 1.4, 3.4, z + 1.78, z + 3.62, "url(#glassR)"));
    house.push(ln([10.04, 2.4, z + 1.78], [10.04, 2.4, z + 3.62], { stroke: "#f4f1ea", strokeWidth: 2 }));
  }

  // Front roof with panels, gutters, porch light and bin. Drawn after the garage, which sits below its eave.
  roof.push(
    poly(
      [
        [-0.4, 4, ridge],
        [10.4, 4, ridge],
        [10.4, 8.6, eave],
        [-0.4, 8.6, eave],
      ],
      "#4a5059",
    ),
  );
  for (const v of [0.2, 0.4, 0.6, 0.8])
    roof.push(ln(PV(-0.4, v), PV(10.4, v), { stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }));
  for (let rr = 0; rr < 2; rr++)
    for (let c = 0; c < 5; c++) {
      const u0 = 0.55 + c * 1.9;
      const u1 = u0 + 1.76;
      const v0 = 0.1 + rr * 0.41;
      const v1 = v0 + 0.37;
      roof.push(
        poly([PV(u0, v1), PV(u1, v1), PV(u1, v0), PV(u0, v0)].map(lift), "url(#pvGrad)", {
          stroke: "#d9dee6",
          strokeWidth: 1,
        }),
      );
      for (const t of [1 / 3, 2 / 3]) {
        const uu = u0 + (u1 - u0) * t;
        roof.push(ln(lift(PV(uu, v0)), lift(PV(uu, v1)), { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 }));
      }
      const vm = (v0 + v1) / 2;
      roof.push(ln(lift(PV(u0, vm)), lift(PV(u1, vm)), { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 }));
    }
  roof.push(ln([-0.4, 4, ridge], [10.4, 4, ridge], { stroke: "#2b2f35", strokeWidth: 3.5 }));
  roof.push(
    ln([-0.4, 8.6, eave], [10.4, 8.6, eave], { stroke: "#ffffff", strokeWidth: 3 }),
    ln([10.4, 4, ridge], [10.4, 8.6, eave], { stroke: "#ffffff", strokeWidth: 3 }),
    ln([10.4, 4, ridge], [10.4, -0.6, eave], { stroke: "#f0ede6", strokeWidth: 3 }),
    ln([-0.4, 4, ridge], [-0.4, 8.6, eave], { stroke: "#ffffff", strokeWidth: 2.5 }),
  );
  roof.push(
    ln([-0.3, 8.5, eave - 0.1], [10.3, 8.5, eave - 0.1], { stroke: "#b9b4aa", strokeWidth: 2.5 }),
    ln([9.85, 8.35, eave - 0.1], [9.85, 8.35, 0.1], { stroke: "#b9b4aa", strokeWidth: 2.5 }),
  );
  {
    const wl = I(6.8, 8.04, 2.6);
    roof.push(
      h("rect", { x: wl[0] - 2.5, y: wl[1] - 4, width: 5, height: 8, rx: 1.5, fill: "#2b2b2b" }),
      h("circle", { cx: wl[0], cy: wl[1] + 1, r: 1.5, fill: "#ffd27a" }),
    );
  }
  roof.push(...box(6.9, 7.2, 9.9, 10.2, 0, 1.2, "#3b3f45", "#2e3136", "#44484f"));

  // The garage: its floor and back wall (seen when it's see-through), then its walls, roof and doors.
  const garageInside: Kid[] = [];
  const garageShell: Kid[] = [];
  if (g) {
    const ghost: Attrs = l.ghostGarage ? { fillOpacity: 0.38, stroke: "#8193ad", strokeWidth: 1.1 } : {};
    if (l.ghostGarage)
      garageInside.push(
        flat(g.x0, g.x1, g.y0, g.y1, 0.02, "#d9d6cf"),
        front(g.y0 + 0.02, g.x0, g.x1, 0, g.top, "#e6e1d7"),
      );
    garageShell.push(
      side(g.x1, g.y0, g.y1, 0, g.top, "#ddd6ca", ghost),
      front(g.y1, g.x0, g.x1, 0, g.top, "#f6f2eb", ghost),
      side(g.x1 + 0.01, g.y0, g.y1, 0, 0.35, "#c2bbad", l.ghostGarage ? { fillOpacity: 0.5 } : {}),
      front(g.y1 + 0.01, g.x0, g.x1, 0, 0.35, "#d8d2c6", l.ghostGarage ? { fillOpacity: 0.5 } : {}),
    );
    // One roller door, wide enough for two cars in a double garage.
    const [d0, d1] = [g.x0 + 0.5, g.x1 - 0.5];
    garageShell.push(
      front(g.y1 + 0.02, d0, d1, 0, 2.5, "#e7e3dc", {
        stroke: "#bdb6a9",
        strokeWidth: 0.8,
        ...(l.ghostGarage ? { fillOpacity: 0.3 } : {}),
      }),
    );
    for (let z = 0.3; z < 2.5; z += 0.3)
      garageShell.push(ln([d0, g.y1 + 0.03, z], [d1, g.y1 + 0.03, z], { stroke: "rgba(0,0,0,0.07)", strokeWidth: 1 }));
    // A flat roof just over the walls, with a little overhang at the front: like glass when it's see-through.
    const roofBox = l.ghostGarage
      ? box(g.x0, g.x1 + 0.15, g.y0 - 0.1, g.y1 + 0.25, g.top, g.top + 0.22, "#dfe7f2", "#c9d3e2", "#d3dcea")
      : box(g.x0, g.x1 + 0.15, g.y0 - 0.1, g.y1 + 0.25, g.top, g.top + 0.22, "#4a5059", "#3c4149", "#43484f");
    garageShell.push(
      l.ghostGarage
        ? h("g", { opacity: 0.4, stroke: "#8193ad", strokeWidth: 1, strokeLinejoin: "round" }, ...roofBox)
        : group(roofBox),
    );
  }

  // the garden, a tree out the front
  for (const x of [0.6, 1.3, 3.7, 4.4, 7.1, 7.8, 9.5]) yard.push(shrub(x, 8.45));
  yard.push(tree(1.2, 10.3, 20));

  // wet ground for rain/storm
  const wet: Kid[] = [flat(gr.x0, gr.x1, gr.y0, gr.y1, 0.03, "rgba(70,90,120,0.1)")];
  const puddles: [number, number, number][] = g
    ? [
        [(g.x0 + g.x1) / 2, gr.y1 - 1, 26],
        [gr.x1 - 1, 0.2, 22],
        [5.8, 9.6, 16],
      ]
    : [
        [12.4, 8.6, 30],
        [14.2, 0.2, 22],
        [5.8, 9.6, 16],
        [13.1, 9.8, 18],
      ];
  for (const [px0, py0, rx] of puddles) {
    const c = I(px0, py0, 0.03);
    wet.push(h("ellipse", { cx: c[0], cy: c[1], rx, ry: rx * 0.36, fill: "rgba(140,160,190,0.45)" }));
  }

  // night: (the sky dims everything, see HouseScene) then the windows and porch light up
  const night: Kid[] = [];
  const warm = "#ffd27f";
  for (const [x0, x1, z] of windows(l)) {
    if (z === 0)
      night.push(
        poly(
          [
            [x0 - 0.3, 8.35, 0.03],
            [x1 + 0.3, 8.35, 0.03],
            [x1 + 1.3, 10.3, 0.03],
            [x0 - 0.5, 10.3, 0.03],
          ],
          warm,
          { fillOpacity: 0.16 },
        ),
      );
    night.push(
      front(8.03, x0, x1, z + 1.78, z + 3.62, warm),
      ln([(x0 + x1) / 2, 8.04, z + 1.78], [(x0 + x1) / 2, 8.04, z + 3.62], { stroke: "#d9a652", strokeWidth: 2 }),
    );
  }
  for (const z of sideWindows(l)) night.push(side(10.03, 1.4, 3.4, z + 1.78, z + 3.62, "#f5c46e"));
  {
    const wl = I(6.8, 8.04, 2.6);
    night.push(
      h("circle", { cx: wl[0], cy: wl[1] + 4, r: 26, fill: warm, fillOpacity: 0.3 }),
      h("circle", { cx: wl[0], cy: wl[1] + 1, r: 3, fill: "#fff3cf" }),
    );
  }

  // Where a car would park: beside the house, or on the driveway in front of the garage.
  const bay = g ? [g.x0 + 0.7, Math.min(g.x0 + 3.1, g.x1 - 0.7), g.y1 + 0.5, gr.y1 - 0.3] : [11.75, 13.95, 1.35, 6.6];

  return {
    ground: group(ground),
    house: group(house),
    garageInside: group(garageInside),
    garageShell: group(garageShell),
    roof: group(roof),
    yard: group(yard),
    wet: group(wet),
    night: group(night),
    parking: flat(bay[0], bay[1], bay[2], bay[3], 0.02, "none", {
      stroke: "rgba(0,0,0,0.28)",
      strokeWidth: 1.5,
      strokeDasharray: "6 6",
    }),
  } satisfies Record<string, ReactElement>;
}

const cache = new Map<string, ReturnType<typeof build>>();
/** The static scenery for a house layout, built on first use. */
export function scenery(l: Layout) {
  const key = houseKey(l.options);
  let s = cache.get(key);
  if (!s) cache.set(key, (s = build(l)));
  return s;
}
