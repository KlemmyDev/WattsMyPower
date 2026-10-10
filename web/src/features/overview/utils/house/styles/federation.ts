import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { federationLevels, type Layout } from "~/features/overview/utils/house/layout";
import { FINISHES, shade, type Finish } from "~/features/overview/utils/house/palette";
import {
  eaveShadow,
  flat,
  front,
  frontWall,
  frontWindow,
  LIT,
  litFront,
  lookOf,
  meterBox,
  panelRows,
  porchLight,
  rowsDown,
  shrub,
  side,
  sideWall,
  sideWindow,
  type Style,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The Federation home: red brick under a terracotta-tiled hip roof, a bay window out the front under its own
 * gable with white timber battens, leadlight above the windows, a brick chimney with terracotta pots, and a
 * white picket fence along the street with roses behind it.
 */

const TRIM = "#fbf7ef";

/** A window with a band of amber leadlight across its top. */
const leadlightFront = (y: number, x0: number, x1: number, z0: number, z1: number): Kid[] => [
  ...frontWindow(y, x0, x1, z0, z1),
  front(y + 0.05, x0, x1, z1 - 0.38, z1, "#d9a85c", { fillOpacity: 0.85 }),
  ln([x0, y + 0.05, z1 - 0.38], [x1, y + 0.05, z1 - 0.38], { stroke: TRIM, strokeWidth: 1.5 }),
];

function draw(l: Layout): StyleParts {
  const f = federationLevels(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, federation.look);
  const TILE = RF.face;
  const TILE_SIDE = RF.side;
  const CAP = RF.cap;
  // The chimney's brick: the walls', or red brick when the walls aren't brick.
  const chim: Finish = walls.material === "brick" ? walls : FINISHES.brick_red;
  const two = l.options.storeys === 2;
  const W = f.wallTop;
  const { eaves: E, ridgeLine: RL, bay: B, chimney: C } = f;
  const R = f.ridge;
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const floors = two ? [0, 3.8] : [0];

  // Brick walls, a white band where the storeys meet, windows with leadlight, the front door, the meter.
  house.push(...sideWall(walls, 10, 0, 8, 0, W, { plinth: true }), ...frontWall(walls, 8, 0, 10, 0, W, true));
  if (two) house.push(front(8.02, 0, 10, 3.7, 3.85, TRIM), side(10.02, 0, 8, 3.7, 3.85, TRIM));
  for (const z of floors) {
    house.push(...leadlightFront(8, 0.6, 2.0, z + 1.4, z + 3.2));
    house.push(...leadlightFront(8, 4.2, 5.4, z + 1.4, z + 3.2));
  }
  house.push(
    front(8.02, 2.5, 3.7, 0, 3.0, TRIM, { stroke: "#d8cfc0", strokeWidth: 0.8 }),
    front(8.03, 2.65, 3.55, 0, 2.5, "#5b3a2a"),
    front(8.03, 2.65, 3.55, 2.58, 2.9, "#d9a85c"),
    meterBox(8, 0.45, 2.4),
  );
  {
    const k = I(3.4, 8.04, 1.3);
    house.push(h("circle", { cx: k[0], cy: k[1], r: 1.8, fill: "#e0c48a" }));
  }
  for (const w of l.sideWindows) house.push(...sideWindow(10, w.y0, w.y1, w.z0, w.z1));
  house.push(...eaveShadow.front(8, 0, 6, W), ...eaveShadow.side(10, 0, 8, W));

  // The bay: brick out to the front with a three-paned window on each floor.
  const bay: Kid[] = [
    ...sideWall(walls, B.x1, 8, B.y1, 0, W, { plinth: true }),
    ...frontWall(walls, B.y1, B.x0, B.x1, 0, W, true),
  ];
  for (const z of floors) {
    bay.push(...leadlightFront(B.y1, B.x0 + 0.4, B.x1 - 0.4, z + 1.2, z + 3.2));
    for (const t of [1 / 3, 2 / 3]) {
      const x = B.x0 + 0.4 + (B.x1 - B.x0 - 0.8) * t;
      bay.push(ln([x, B.y1 + 0.05, z + 1.2], [x, B.y1 + 0.05, z + 3.2], { stroke: TRIM, strokeWidth: 2.4 }));
    }
  }

  // The chimney stands behind the ridge, so it goes before the roof covers its base.
  roof.push(...box(C.x0, C.x1, C.y0, C.y1, W, C.top, shade(chim.face, -0.05), chim.side, chim.face));
  for (const x of [C.x0 + 0.22, C.x1 - 0.22]) {
    const p = I(x, (C.y0 + C.y1) / 2, C.top);
    roof.push(h("rect", { x: p[0] - 3, y: p[1] - 9, width: 6, height: 9, rx: 1.5, fill: "#c8643f" }));
  }

  // The hip roof: the street side and the right side, tiled in rows, with panels on both.
  roof.push(
    poly(
      [
        [E.x0, E.y1, W],
        [E.x1, E.y1, W],
        [RL.x1, RL.y, R],
        [RL.x0, RL.y, R],
      ],
      TILE,
    ),
    poly(
      [
        [E.x1, E.y0, W],
        [E.x1, E.y1, W],
        [RL.x1, RL.y, R],
      ],
      TILE_SIDE,
    ),
  );
  /** A point on the street side at height t (0 eave..1 ridge), u along (0 left hip..1 right hip). */
  const onFront = (u: number, t: number): P3 => {
    const x0 = E.x0 + (RL.x0 - E.x0) * t;
    const x1 = E.x1 - (E.x1 - RL.x1) * t;
    return [x0 + (x1 - x0) * u, E.y1 - (E.y1 - RL.y) * t, W + (R - W) * t];
  };
  /** A point on the right side at height t, v along (0 back hip..1 front hip). */
  const onSide = (v: number, t: number): P3 => {
    const y0 = E.y0 + (RL.y - E.y0) * t;
    const y1 = E.y1 - (E.y1 - RL.y) * t;
    return [E.x1 - (E.x1 - RL.x1) * t, y0 + (y1 - y0) * v, W + (R - W) * t];
  };
  for (let t = 0.1; t < 1; t += 0.1) {
    roof.push(ln(onFront(0, t), onFront(1, t), { stroke: RF.line, strokeWidth: 1 }));
    roof.push(ln(onSide(0, t), onSide(1, t), { stroke: RF.line, strokeWidth: 1 }));
  }
  // Panels on the street side, left of the bay's gable, then on the right side.
  const fSlope = Math.hypot(E.y1 - RL.y, R - W);
  const sSlope = Math.hypot(E.x1 - RL.x1, R - W);
  const frontAt = (u: number, v: number): P3 => {
    const p = onFront(0, 1 - v / fSlope);
    return [u, p[1] - 0.05, (p[2] ?? 0) + 0.1];
  };
  const sideAt = (u: number, v: number): P3 => {
    const p = onSide(0, 1 - v / sSlope);
    return [p[0] + 0.05, u, (p[2] ?? 0) + 0.1];
  };
  const onF = panelRows(
    frontAt,
    rowsDown(0.2, fSlope - 0.12, 1.36, (v) => {
      const t = 1 - v / fSlope;
      return [onFront(0, t)[0] + 0.3, Math.min(onFront(1, t)[0] - 0.3, B.x0 - 0.5)];
    }).reverse(),
    l.options.panels,
  );
  const onS = panelRows(
    sideAt,
    rowsDown(0.2, sSlope - 0.12, 1.36, (v) => {
      const t = 1 - v / sSlope;
      return [onSide(0, t)[1] + 0.3, onSide(1, t)[1] - 0.3];
    }).reverse(),
    l.options.panels - onF.placed,
  );
  roof.push(...onF.kids, ...onS.kids);
  roof.push(
    ln([RL.x0, RL.y, R], [RL.x1, RL.y, R], { stroke: CAP, strokeWidth: 3 }),
    ln([E.x0, E.y1, W], [RL.x0, RL.y, R], { stroke: CAP, strokeWidth: 2.4 }),
    ln([E.x1, E.y1, W], [RL.x1, RL.y, R], { stroke: CAP, strokeWidth: 2.4 }),
    ln([E.x1, E.y0, W], [RL.x1, RL.y, R], { stroke: CAP, strokeWidth: 2.4 }),
    ln([E.x0, E.y1, W - 0.05], [E.x1, E.y1, W - 0.05], { stroke: TRIM, strokeWidth: 2.5 }),
  );

  // The bay and its gable, nearest the street: the gable's right slope meets the main roof in a valley.
  roof.push(...bay);
  const g = { x0: B.x0 - 0.2, x1: B.x1 + 0.2, y: B.y1 + 0.3 };
  const valleyY = E.y1 - ((B.gable - W) / (R - W)) * (E.y1 - RL.y);
  roof.push(
    poly(
      [
        [B.peak, g.y, B.gable],
        [g.x1, g.y, W],
        [g.x1, E.y1, W],
        [B.peak, valleyY, B.gable],
      ],
      TILE_SIDE,
    ),
  );
  for (let t = 0.15; t < 1; t += 0.17)
    roof.push(
      ln(
        [B.peak + (g.x1 - B.peak) * t, g.y, B.gable - (B.gable - W) * t],
        [B.peak + (g.x1 - B.peak) * t, valleyY + (E.y1 - valleyY) * t, B.gable - (B.gable - W) * t],
        { stroke: RF.line, strokeWidth: 1 },
      ),
    );
  roof.push(
    poly(
      [
        [g.x0, g.y, W],
        [g.x1, g.y, W],
        [B.peak, g.y, B.gable],
      ],
      TRIM,
    ),
  );
  for (let x = g.x0 + 0.5; x < g.x1 - 0.3; x += 0.42) {
    const top = B.gable - (Math.abs(x - B.peak) / (B.peak - g.x0)) * (B.gable - W);
    roof.push(ln([x, g.y + 0.01, W + 0.05], [x, g.y + 0.01, top - 0.1], { stroke: "#d9cfbf", strokeWidth: 1.4 }));
  }
  roof.push(
    ln([g.x0, g.y, W], [B.peak, g.y, B.gable], { stroke: "#ffffff", strokeWidth: 3 }),
    ln([B.peak, g.y, B.gable], [g.x1, g.y, W], { stroke: "#ffffff", strokeWidth: 3 }),
    ln([B.peak, g.y, B.gable], [B.peak, valleyY, B.gable], { stroke: CAP, strokeWidth: 2.6 }),
  );
  const light = porchLight([3.95, 8.04, 2.6]);
  roof.push(...light.lamp);

  // At night the windows glow, leadlight and all.
  for (const z of floors) {
    night.push(
      ...litFront(8, 0.6, 2.0, z + 1.4, z + 2.82, z === 0),
      ...litFront(8, 4.2, 5.4, z + 1.4, z + 2.82, z === 0),
    );
    night.push(...litFront(B.y1, B.x0 + 0.4, B.x1 - 0.4, z + 1.2, z + 2.82, z === 0));
  }
  for (const w of l.sideWindows) night.push(side(10.04, w.y0, w.y1, w.z0, w.z1, LIT));
  night.push(...light.glow);

  return {
    house,
    roof,
    night,
    yard: [
      ...[0.5, 1.2, 1.9, 4.4, 5.1].map((x) => shrub(x, 8.45, 6.5, "#9dbd8c")),
      ...[0.8, 4.7].map((x) => shrub(x, 8.5, 2.5, "#e58aa4")),
    ],
    trees: [[0.4, l.ground.y1 - 0.95, 18]],
    paths: [
      flat(2.6, 3.6, 8, l.ground.y1, 0.01, "#e2d6c6"),
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

export const federation: Style = {
  draw,
  look: { walls: "brick_red", roof: "terracotta", fence: "picket", garden: "leafy" },
};
