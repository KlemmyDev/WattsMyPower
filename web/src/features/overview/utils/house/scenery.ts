import type { ReactElement } from "react";
import { box, group, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";

/*
 * The parts of the drawing that never change: ground, house, roof panels, yard, and the overlays
 * for wet ground and night. Built once on first use and reused for every render.
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

/** A point on the front roof plane: u along the ridge, v down the slope (0..1). */
const PV = (u: number, v: number): P3 => [u, 4 + 4.6 * v, 8 - 3.45 * v];
/** Raise a point just off the roof so panels sit on top of it. */
const lift = (p: P3): P3 => [p[0], p[1] - 0.05, (p[2] ?? 0) + 0.12];

const WINDOWS: [number, number][] = [
  [1.4, 3.4],
  [7.4, 9.2],
];

function build() {
  const ground: Kid[] = [];
  const house: Kid[] = [];
  const front: Kid[] = [];
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
  ground.push(...box(-2, 15, -1, 10.4, -0.5, 0, "#e3e9da", "#c3ccb7", "#d2dac6"));
  ground.push(
    poly(
      [
        [11, -1, 0.01],
        [15, -1, 0.01],
        [15, 10.4, 0.01],
        [11, 10.4, 0.01],
      ],
      "#ebeae5",
    ),
  );
  ground.push(
    poly(
      [
        [15, -1, -0.5],
        [15, 10.4, -0.5],
        [15, 10.4, 0],
        [15, -1, 0],
      ],
      "#cfcdc6",
    ),
    poly(
      [
        [11, 10.4, -0.5],
        [15, 10.4, -0.5],
        [15, 10.4, 0],
        [11, 10.4, 0],
      ],
      "#dcdad3",
    ),
  );
  for (const yy of [1.0, 7.0])
    ground.push(ln([11.3, yy, 0.02], [14.7, yy, 0.02], { stroke: "rgba(0,0,0,0.06)", strokeWidth: 1.5 }));
  ground.push(
    poly(
      [
        [5.2, 8, 0.01],
        [6.4, 8, 0.01],
        [6.4, 10.4, 0.01],
        [5.2, 10.4, 0.01],
      ],
      "#ebeae5",
    ),
  );
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

  // back tree, power pole, walls, windows, door, meter
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
        [-0.4, 4, 8],
        [10.4, 4, 8],
        [10.4, -0.6, 4.55],
        [-0.4, -0.6, 4.55],
      ],
      "#353a42",
    ),
  );
  house.push(
    poly(
      [
        [10, 0, 0],
        [10, 8, 0],
        [10, 8, 5],
        [10, 0, 5],
      ],
      "#ddd6ca",
    ),
    poly(
      [
        [10, 0, 5],
        [10, 8, 5],
        [10, 4, 8],
      ],
      "#d6cfc2",
    ),
  );
  house.push(
    poly(
      [
        [0, 8, 0],
        [10, 8, 0],
        [10, 8, 5],
        [0, 8, 5],
      ],
      "#f6f2eb",
    ),
  );
  house.push(
    poly(
      [
        [0, 8.01, 0],
        [10, 8.01, 0],
        [10, 8.01, 0.35],
        [0, 8.01, 0.35],
      ],
      "#d8d2c6",
    ),
    poly(
      [
        [10.01, 0, 0],
        [10.01, 8, 0],
        [10.01, 8, 0.35],
        [10.01, 0, 0.35],
      ],
      "#c2bbad",
    ),
  );
  for (const [x0, x1] of WINDOWS) {
    house.push(
      poly(
        [
          [x0 - 0.14, 8.02, 1.64],
          [x1 + 0.14, 8.02, 1.64],
          [x1 + 0.14, 8.02, 3.76],
          [x0 - 0.14, 8.02, 3.76],
        ],
        "#ffffff",
        { stroke: "#cfc8bb", strokeWidth: 0.8 },
      ),
    );
    house.push(
      poly(
        [
          [x0, 8.03, 1.78],
          [x1, 8.03, 1.78],
          [x1, 8.03, 3.62],
          [x0, 8.03, 3.62],
        ],
        "url(#glassL)",
      ),
    );
    house.push(ln([(x0 + x1) / 2, 8.04, 1.78], [(x0 + x1) / 2, 8.04, 3.62], { stroke: "#ffffff", strokeWidth: 2 }));
    house.push(
      poly(
        [
          [x0 - 0.25, 8.3, 1.55],
          [x1 + 0.25, 8.3, 1.55],
          [x1 + 0.25, 8.02, 1.64],
          [x0 - 0.25, 8.02, 1.64],
        ],
        "#e9e3d8",
      ),
    );
  }
  house.push(
    poly(
      [
        [5.1, 8.02, 0],
        [6.5, 8.02, 0],
        [6.5, 8.02, 3.25],
        [5.1, 8.02, 3.25],
      ],
      "#ffffff",
      { stroke: "#cfc8bb", strokeWidth: 0.8 },
    ),
  );
  house.push(
    poly(
      [
        [5.25, 8.03, 0],
        [6.35, 8.03, 0],
        [6.35, 8.03, 3.1],
        [5.25, 8.03, 3.1],
      ],
      "#6e5038",
    ),
  );
  {
    const dh = I(6.15, 8.04, 1.5);
    house.push(h("circle", { cx: dh[0], cy: dh[1], r: 1.8, fill: "#e0c48a" }));
  }
  house.push(
    poly(
      [
        [0.6, 8.03, 2.7],
        [1.2, 8.03, 2.7],
        [1.2, 8.03, 3.55],
        [0.6, 8.03, 3.55],
      ],
      "#ececec",
      { stroke: "#a9a9a9", strokeWidth: 0.8 },
    ),
  );

  // side window, front roof with panels, gutters, porch light, bin
  front.push(
    poly(
      [
        [10.02, 1.26, 1.64],
        [10.02, 3.54, 1.64],
        [10.02, 3.54, 3.76],
        [10.02, 1.26, 3.76],
      ],
      "#f4f1ea",
      { stroke: "#bfb8aa", strokeWidth: 0.8 },
    ),
  );
  front.push(
    poly(
      [
        [10.03, 1.4, 1.78],
        [10.03, 3.4, 1.78],
        [10.03, 3.4, 3.62],
        [10.03, 1.4, 3.62],
      ],
      "url(#glassR)",
    ),
  );
  front.push(ln([10.04, 2.4, 1.78], [10.04, 2.4, 3.62], { stroke: "#f4f1ea", strokeWidth: 2 }));
  front.push(
    poly(
      [
        [-0.4, 4, 8],
        [10.4, 4, 8],
        [10.4, 8.6, 4.55],
        [-0.4, 8.6, 4.55],
      ],
      "#4a5059",
    ),
  );
  for (const v of [0.2, 0.4, 0.6, 0.8])
    front.push(ln(PV(-0.4, v), PV(10.4, v), { stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }));
  for (let rr = 0; rr < 2; rr++)
    for (let c = 0; c < 5; c++) {
      const u0 = 0.55 + c * 1.9;
      const u1 = u0 + 1.76;
      const v0 = 0.1 + rr * 0.41;
      const v1 = v0 + 0.37;
      front.push(
        poly([PV(u0, v1), PV(u1, v1), PV(u1, v0), PV(u0, v0)].map(lift), "url(#pvGrad)", {
          stroke: "#d9dee6",
          strokeWidth: 1,
        }),
      );
      for (const t of [1 / 3, 2 / 3]) {
        const uu = u0 + (u1 - u0) * t;
        front.push(ln(lift(PV(uu, v0)), lift(PV(uu, v1)), { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 }));
      }
      const vm = (v0 + v1) / 2;
      front.push(ln(lift(PV(u0, vm)), lift(PV(u1, vm)), { stroke: "rgba(255,255,255,0.14)", strokeWidth: 0.7 }));
    }
  front.push(ln([-0.4, 4, 8], [10.4, 4, 8], { stroke: "#2b2f35", strokeWidth: 3.5 }));
  front.push(
    ln([-0.4, 8.6, 4.55], [10.4, 8.6, 4.55], { stroke: "#ffffff", strokeWidth: 3 }),
    ln([10.4, 4, 8], [10.4, 8.6, 4.55], { stroke: "#ffffff", strokeWidth: 3 }),
    ln([10.4, 4, 8], [10.4, -0.6, 4.55], { stroke: "#f0ede6", strokeWidth: 3 }),
    ln([-0.4, 4, 8], [-0.4, 8.6, 4.55], { stroke: "#ffffff", strokeWidth: 2.5 }),
  );
  front.push(
    ln([-0.3, 8.5, 4.45], [10.3, 8.5, 4.45], { stroke: "#b9b4aa", strokeWidth: 2.5 }),
    ln([9.85, 8.35, 4.45], [9.85, 8.35, 0.1], { stroke: "#b9b4aa", strokeWidth: 2.5 }),
  );
  {
    const wl = I(6.8, 8.04, 2.6);
    front.push(
      h("rect", { x: wl[0] - 2.5, y: wl[1] - 4, width: 5, height: 8, rx: 1.5, fill: "#2b2b2b" }),
      h("circle", { cx: wl[0], cy: wl[1] + 1, r: 1.5, fill: "#ffd27a" }),
    );
  }
  front.push(...box(6.9, 7.2, 9.9, 10.2, 0, 1.2, "#3b3f45", "#2e3136", "#44484f"));
  // inverter and battery cases
  front.push(...box(10, 10.22, 5.6, 6.4, 2.4, 3.4, "#ffffff", "#f3f3f3", "#dddddd"));
  front.push(...box(10, 10.32, 3.9, 5.1, 0.3, 2.9, "#ffffff", "#fafafa", "#e1e1e1"));

  // charger box, garden, empty parking space
  yard.push(...box(10, 10.14, 7.0, 7.4, 1.5, 2.3, "#fafafa", "#f1f1f1", "#d9d9d9"));
  for (const x of [0.6, 1.3, 3.7, 4.4, 7.1, 7.8, 9.5]) yard.push(shrub(x, 8.45));
  yard.push(tree(1.2, 10.3, 20));

  // wet ground for rain/storm
  const wet: Kid[] = [
    poly(
      [
        [-2, -1, 0.03],
        [15, -1, 0.03],
        [15, 10.4, 0.03],
        [-2, 10.4, 0.03],
      ],
      "rgba(70,90,120,0.1)",
    ),
  ];
  const puddles: [number, number, number][] = [
    [12.4, 8.6, 30],
    [14.2, 0.2, 22],
    [5.8, 9.6, 16],
    [13.1, 9.8, 18],
  ];
  for (const [px0, py0, rx] of puddles) {
    const c = I(px0, py0, 0.03);
    wet.push(h("ellipse", { cx: c[0], cy: c[1], rx, ry: rx * 0.36, fill: "rgba(140,160,190,0.45)" }));
  }

  // night: dim everything, then light the windows and porch
  const night: Kid[] = [
    h("rect", {
      x: -204,
      y: -4,
      width: 1208,
      height: 608,
      fill: "#16203a",
      fillOpacity: 0.55,
      style: { mixBlendMode: "multiply" },
    }),
  ];
  const warm = "#ffd27f";
  for (const [x0, x1] of WINDOWS) {
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
      poly(
        [
          [x0, 8.03, 1.78],
          [x1, 8.03, 1.78],
          [x1, 8.03, 3.62],
          [x0, 8.03, 3.62],
        ],
        warm,
      ),
      ln([(x0 + x1) / 2, 8.04, 1.78], [(x0 + x1) / 2, 8.04, 3.62], { stroke: "#d9a652", strokeWidth: 2 }),
    );
  }
  night.push(
    poly(
      [
        [10.03, 1.4, 1.78],
        [10.03, 3.4, 1.78],
        [10.03, 3.4, 3.62],
        [10.03, 1.4, 3.62],
      ],
      "#f5c46e",
    ),
  );
  {
    const wl = I(6.8, 8.04, 2.6);
    night.push(
      h("circle", { cx: wl[0], cy: wl[1] + 4, r: 26, fill: warm, fillOpacity: 0.3 }),
      h("circle", { cx: wl[0], cy: wl[1] + 1, r: 3, fill: "#fff3cf" }),
    );
  }

  return {
    ground: group(ground),
    house: group(house),
    front: group(front),
    yard: group(yard),
    wet: group(wet),
    night: group(night),
    parking: poly(
      [
        [11.75, 1.35, 0.02],
        [13.95, 1.35, 0.02],
        [13.95, 6.6, 0.02],
        [11.75, 6.6, 0.02],
      ],
      "none",
      { stroke: "rgba(0,0,0,0.28)", strokeWidth: 1.5, strokeDasharray: "6 6" },
    ),
  } satisfies Record<string, ReactElement>;
}

let cached: ReturnType<typeof build> | undefined;
/** The static scenery, built on first use. */
export const scenery = () => (cached ??= build());
