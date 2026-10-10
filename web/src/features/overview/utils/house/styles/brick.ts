import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { brickLevels, type Layout } from "~/features/overview/utils/house/layout";
import { shade } from "~/features/overview/utils/house/palette";
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
 * The brick-and-tile home, the suburbs' most common: face brick under a hip roof of concrete tiles, the front door
 * set back in a tiled entry under the eaves, windows with colonial bars, a letterbox pier by the path and a lawn
 * edged with shrubs.
 */

function draw(l: Layout): StyleParts {
  const b = brickLevels(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, brick.look);
  const two = l.options.storeys === 2;
  const { wallTop: W, ridge: R, eaves: E, ridgeLine: RL, porch: P } = b;
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const floors = two ? [0, 3.5] : [0];
  const entryTop = two ? 3.0 : W; // the entry's ceiling: the eaves' soffit, or the floor above

  // The side, then the front either side of the entry, and the entry itself: its back wall with the door, the wall
  // down its left side, its tiled floor, all a little in shadow.
  house.push(...sideWall(walls, 10, 0, 8, 0, W, { plinth: true }));
  house.push(
    ...frontWall(walls, P.y, P.x0, P.x1, 0, entryTop, true),
    front(P.y + 0.02, 3.95, 5.05, 0, 2.45, "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }),
    front(P.y + 0.03, 4.08, 4.92, 0, 2.35, "#5a4434"),
    front(P.y + 0.03, 4.25, 4.75, 1.2, 2.1, "url(#glassL)", { fillOpacity: 0.8 }),
    front(P.y + 0.02, 5.15, 5.5, 0, 2.35, "url(#glassL)", { stroke: "#ffffff", strokeWidth: 1.2 }),
    ...sideWall(walls, P.x0, P.y, 8, 0, entryTop),
    flat(P.x0, P.x1, P.y, 8, 0.04, "#d8d1c4"),
    front(P.y + 0.04, P.x0, P.x1, 0, entryTop, "#1b1f2a", { fillOpacity: 0.12 }),
    side(P.x0 + 0.02, P.y, 8, 0, entryTop, "#1b1f2a", { fillOpacity: 0.1 }),
  );
  {
    const k = I(4.8, P.y + 0.04, 1.15);
    house.push(h("circle", { cx: k[0], cy: k[1], r: 1.6, fill: "#e0c48a" }));
  }
  house.push(...frontWall(walls, 8, 0, P.x0, 0, W, true), ...frontWall(walls, 8, P.x1, 10, 0, W, true));
  if (two) house.push(...frontWall(walls, 8, P.x0, P.x1, entryTop, W));
  for (const z of floors) {
    house.push(...frontWindow(8, 0.7, 2.6, z + 1.25, z + 2.85, { bars: true }));
    house.push(...frontWindow(8, 6.4, 9.3, z + 1.25, z + 2.85, { bars: true }));
    if (z > 0) house.push(...frontWindow(8, 3.9, 5.1, z + 1.25, z + 2.85, { bars: true }));
  }
  house.push(meterBox(8, 9.35, 1.7));
  for (const w of l.sideWindows) house.push(...sideWindow(10, w.y0, w.y1, w.z0, w.z1));
  house.push(...eaveShadow.front(8, 0, 10, W), ...eaveShadow.side(10, 0, 8, W));

  // The hip roof: the street side and the right side, in rows of tiles, the panels on both.
  roof.push(
    poly(
      [
        [E.x0, E.y1, W],
        [E.x1, E.y1, W],
        [RL.x1, RL.y, R],
        [RL.x0, RL.y, R],
      ],
      RF.face,
    ),
    poly(
      [
        [E.x1, E.y0, W],
        [E.x1, E.y1, W],
        [RL.x1, RL.y, R],
      ],
      RF.side,
    ),
  );
  /** Points on the street side and the right side at height t (0 eave..1 ridge), u along (0..1 hip to hip). */
  const onFront = (u: number, t: number): P3 => {
    const x0 = E.x0 + (RL.x0 - E.x0) * t;
    const x1 = E.x1 - (E.x1 - RL.x1) * t;
    return [x0 + (x1 - x0) * u, E.y1 - (E.y1 - RL.y) * t, W + (R - W) * t];
  };
  const onSide = (u: number, t: number): P3 => {
    const y0 = E.y0 + (RL.y - E.y0) * t;
    const y1 = E.y1 - (E.y1 - RL.y) * t;
    return [E.x1 - (E.x1 - RL.x1) * t, y0 + (y1 - y0) * u, W + (R - W) * t];
  };
  for (let t = 0.08; t < 1; t += 0.08) {
    roof.push(ln(onFront(0, t), onFront(1, t), { stroke: RF.line, strokeWidth: 0.9 }));
    roof.push(ln(onSide(0, t), onSide(1, t), { stroke: RF.line, strokeWidth: 0.9 }));
  }
  const fSlope = Math.hypot(E.y1 - RL.y, R - W);
  const sSlope = Math.hypot(E.x1 - RL.x1, R - W);
  const onF = panelRows(
    (u, v) => {
      const p = onFront(0, 1 - v / fSlope);
      return [u, p[1] - 0.05, (p[2] ?? 0) + 0.1];
    },
    rowsDown(0.2, fSlope - 0.12, 1.36, (v) => {
      const t = 1 - v / fSlope;
      return [onFront(0, t)[0] + 0.3, onFront(1, t)[0] - 0.3];
    }).reverse(),
    l.options.panels,
  );
  const onS = panelRows(
    (u, v) => {
      const p = onSide(0, 1 - v / sSlope);
      return [p[0] + 0.05, u, (p[2] ?? 0) + 0.1];
    },
    rowsDown(0.2, sSlope - 0.12, 1.36, (v) => {
      const t = 1 - v / sSlope;
      return [onSide(0, t)[1] + 0.3, onSide(1, t)[1] - 0.3];
    }).reverse(),
    l.options.panels - onF.placed,
  );
  roof.push(...onF.kids, ...onS.kids);
  roof.push(
    ln([RL.x0, RL.y, R], [RL.x1, RL.y, R], { stroke: RF.cap, strokeWidth: 3 }),
    ln([E.x0, E.y1, W], [RL.x0, RL.y, R], { stroke: RF.cap, strokeWidth: 2.4 }),
    ln([E.x1, E.y1, W], [RL.x1, RL.y, R], { stroke: RF.cap, strokeWidth: 2.4 }),
    ln([E.x1, E.y0, W], [RL.x1, RL.y, R], { stroke: shade(RF.cap, -0.08), strokeWidth: 2.4 }),
    // the gutter along the front and the side
    ln([E.x0, E.y1, W - 0.06], [E.x1, E.y1, W - 0.06], { stroke: "#e9e6df", strokeWidth: 2.6 }),
    ln([E.x1, E.y0, W - 0.06], [E.x1, E.y1, W - 0.06], { stroke: "#d9d5cc", strokeWidth: 2.4 }),
    ln([10.3, 8.4, W - 0.1], [10.3, 8.4, 0.1], { stroke: "#cfcac0", strokeWidth: 2.4 }),
  );
  const light = porchLight([P.x0 + 0.35, P.y + 0.05, 2.2]);
  roof.push(...light.lamp);
  // A letterbox pier of the walls' brick by the path, at the street.
  const lb = { x0: 5.2, x1: 5.75, y0: l.ground.y1 - 0.9, y1: l.ground.y1 - 0.4 };
  roof.push(...box(lb.x0, lb.x1, lb.y0, lb.y1, 0, 1.15, shade(walls.face, 0.08), walls.side, walls.face));
  roof.push(front(lb.y1 + 0.01, lb.x0 + 0.12, lb.x1 - 0.12, 0.75, 0.85, "#2b2b2b"));

  for (const z of floors) {
    night.push(
      ...litFront(8, 0.7, 2.6, z + 1.25, z + 2.85, z === 0),
      ...litFront(8, 6.4, 9.3, z + 1.25, z + 2.85, z === 0),
    );
    if (z > 0) night.push(...litFront(8, 3.9, 5.1, z + 1.25, z + 2.85));
  }
  night.push(front(P.y + 0.05, 5.15, 5.5, 0, 2.35, LIT), ...light.glow);
  for (const w of l.sideWindows) night.push(side(10.04, w.y0, w.y1, w.z0, w.z1, LIT));

  return {
    house,
    roof,
    night,
    yard: [
      ...[0.4, 1.1, 1.8, 2.5].map((x) => shrub(x, 8.45, 6, "#93b580")),
      ...[6.3, 7.0, 7.7, 8.4, 9.1].map((x) => shrub(x, 8.45, 5.5, "#a3c290")),
    ],
    trees: [[1.6, 10.2, 19]],
    paths: [
      flat(P.x0 + 0.7, P.x1 - 0.7, 8, l.ground.y1, 0.01, "#e4ddd0"),
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

export const brick: Style = {
  draw,
  look: { walls: "brick_blonde", roof: "basalt", fence: "none", garden: "leafy" },
};
