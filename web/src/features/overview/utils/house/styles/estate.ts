import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { estateLevels, type Layout } from "~/features/overview/utils/house/layout";
import {
  flat,
  front,
  frontWindow,
  litFront,
  panel,
  porchLight,
  shrub,
  side,
  sideWindow,
  tree,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The estate home: brick-veneer walls in a pale render, a gable roof of dark tiles along its length with the
 * panels on its street side, a front door between two windows, and a garden bed along the front.
 */

export function estate(l: Layout): StyleParts {
  const { wallTop, eave, ridge } = estateLevels(l.options.storeys);
  const two = l.options.storeys === 2;
  /** A point on the front roof plane: u along the ridge, v down the slope (0..1). */
  const PV = (u: number, v: number): P3 => [u, 4 + 4.6 * v, ridge - (ridge - eave) * v];
  /** Raise a point just off the roof so panels sit on top of it. */
  const lift = (p: P3): P3 => [p[0], p[1] - 0.05, (p[2] ?? 0) + 0.12];
  const windows: [number, number, number][] = [
    [1.4, 3.4, 0],
    [7.4, 9.2, 0],
    ...(two
      ? ([
          [1.4, 3.4, 4],
          [4.9, 6.7, 4],
          [7.4, 9.2, 4],
        ] as [number, number, number][])
      : []),
  ];
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const light = porchLight([6.8, 8.04, 2.6]);

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
    side(10, 0, 8, 0, wallTop, "#ddd6ca"),
    poly(
      [
        [10, 0, wallTop],
        [10, 8, wallTop],
        [10, 4, ridge],
      ],
      "#d6cfc2",
    ),
    front(8, 0, 10, 0, wallTop, "#f6f2eb"),
    front(8.01, 0, 10, 0, 0.35, "#d8d2c6"),
    side(10.01, 0, 8, 0, 0.35, "#c2bbad"),
  );
  if (two)
    house.push(
      front(8.01, 0, 10, 4.45, 4.6, "#e7e1d6"), // the floor band between storeys
      side(10.01, 0, 8, 4.45, 4.6, "#cfc8bb"),
    );
  for (const [x0, x1, z] of windows) house.push(...frontWindow(8, x0, x1, z + 1.78, z + 3.62));
  house.push(front(8.02, 5.1, 6.5, 0, 3.25, "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }));
  house.push(front(8.03, 5.25, 6.35, 0, 3.1, "#6e5038"));
  {
    const dh = I(6.15, 8.04, 1.5);
    house.push(h("circle", { cx: dh[0], cy: dh[1], r: 1.8, fill: "#e0c48a" }));
  }
  house.push(front(8.03, 0.6, 1.2, 2.7, 3.55, "#ececec", { stroke: "#a9a9a9", strokeWidth: 0.8 }));
  for (const w of l.sideWindows) house.push(...sideWindow(10, w.y0 + 0.14, w.y1 - 0.14, w.z0 + 0.14, w.z1 - 0.14));

  // Front roof with panels, gutters, porch light and bin.
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
      roof.push(...panel(lift(PV(u0, v1)), lift(PV(u1, v1)), lift(PV(u1, v0)), lift(PV(u0, v0))));
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
  roof.push(...light.lamp);
  roof.push(...box(6.9, 7.2, 9.9, 10.2, 0, 1.2, "#3b3f45", "#2e3136", "#44484f"));

  // At night the windows and porch light up.
  for (const [x0, x1, z] of windows) {
    night.push(...litFront(8, x0, x1, z + 1.78, z + 3.62, z === 0));
    night.push(
      ln([(x0 + x1) / 2, 8.04, z + 1.78], [(x0 + x1) / 2, 8.04, z + 3.62], { stroke: "#d9a652", strokeWidth: 2 }),
    );
  }
  for (const w of l.sideWindows) night.push(side(10.03, w.y0 + 0.14, w.y1 - 0.14, w.z0 + 0.14, w.z1 - 0.14, "#f5c46e"));
  night.push(...light.glow);

  return {
    house,
    roof,
    night,
    yard: [...[0.6, 1.3, 3.7, 4.4, 7.1, 7.8, 9.5].map((x) => shrub(x, 8.45)), tree(1.2, 10.3, 20)],
    paths: [
      flat(5.2, 6.4, 8, l.ground.y1, 0.01, "#ebeae5"),
      poly(
        [
          [0, 8, 0.02],
          [10, 8, 0.02],
          [10.6, 10.4, 0.02],
          [0.6, 10.4, 0.02],
        ],
        "rgba(30,40,30,0.08)",
      ),
    ],
  };
}
