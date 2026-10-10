import { h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { coastalLevels, type Layout } from "~/features/overview/utils/house/layout";
import {
  flat,
  front,
  frontWall,
  LIT,
  litFront,
  lookOf,
  meterBox,
  panelRows,
  rowsDown,
  shrub,
  side,
  sideWall,
  WARM,
  type Style,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The coastal home: a skillion roof falling to the street over white weatherboards, a strip of clerestory glass up
 * the side under it, a cedar-clad entry, sliding glass across the front onto a timber deck, and gums and grasses in
 * the garden.
 */

const CEDAR = "#b98557";
const FRAME = "#3b3f45";
const DECK = "#bf9a6c";

/** Glass doors or windows across a wall facing the street, in thin dark frames. */
function sliders(y: number, x0: number, x1: number, z0: number, z1: number, panes: number): Kid[] {
  const out: Kid[] = [
    front(y + 0.01, x0 - 0.08, x1 + 0.08, z0 - 0.08, z1 + 0.08, FRAME),
    front(y + 0.02, x0, x1, z0, z1, "url(#glassL)"),
    poly(
      [
        [x0 + 0.3, y + 0.03, z1],
        [x0 + 1.3, y + 0.03, z1],
        [x0 + 0.3, y + 0.03, z0 + (z1 - z0) * 0.3],
      ],
      "#ffffff",
      { fillOpacity: 0.18 },
    ),
  ];
  for (let i = 1; i < panes; i++) {
    const x = x0 + ((x1 - x0) * i) / panes;
    out.push(ln([x, y + 0.03, z0], [x, y + 0.03, z1], { stroke: FRAME, strokeWidth: 1.8 }));
  }
  return out;
}

function draw(l: Layout): StyleParts {
  const c = coastalLevels(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, coastal.look);
  const { low: L, roofAt, floor } = c;
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const glassTop = (floor ?? L) - 0.45;

  // The walls: the side rising to the back under the roof, the front, and the cedar around the door.
  house.push(
    ...sideWall(walls, 10, 0, 8, 0, roofAt(0), { z1b: L }),
    ...frontWall(walls, 8, 0, 10, 0, L),
    front(8.01, 0, 10, 0, 0.3, walls.plinth),
    side(10.01, 0, 8, 0, 0.3, walls.plinth),
    front(8.02, 0.6, 3.3, 0, floor ?? L, CEDAR),
  );
  for (let x = 0.75; x < 3.3; x += 0.15)
    house.push(ln([x, 8.03, 0], [x, 8.03, floor ?? L], { stroke: "rgba(70,35,10,0.16)", strokeWidth: 0.8 }));
  house.push(
    front(8.03, 1.5, 2.5, 0, 2.6, "#2f3236"),
    ln([2.35, 8.04, 0.9], [2.35, 8.04, 1.9], { stroke: "#d6d9dc", strokeWidth: 2 }),
    front(8.03, 0.8, 1.25, 0.2, 2.6, "url(#glassL)", { stroke: FRAME, strokeWidth: 1 }),
    meterBox(8, 3.45, 1.9),
    ...sliders(8, 3.9, 9.6, 0.3, glassTop, 4),
  );
  if (floor)
    house.push(
      front(8.02, 0, 10, floor - 0.06, floor + 0.08, walls.plinth),
      side(10.02, 0, 8, floor - 0.06, floor + 0.08, walls.plinth),
      ...sliders(8, 0.9, 3.0, floor + 0.7, L - 0.45, 2),
      ...sliders(8, 3.9, 9.6, floor + 0.5, L - 0.45, 4),
    );
  // A strip of clerestory glass up the side, just under the roof where the wall's tallest.
  const cl = (y: number, d: number): P3 => [10.02, y, roofAt(y) - d];
  house.push(
    poly([cl(0.8, 0.25), cl(5.4, 0.25), cl(5.4, 0.85), cl(0.8, 0.85)], "url(#glassR)", {
      stroke: FRAME,
      strokeWidth: 1.2,
    }),
  );
  for (const w of l.sideWindows)
    house.push(
      side(10.01, w.y0 - 0.08, w.y1 + 0.08, w.z0 - 0.08, w.z1 + 0.08, FRAME),
      side(10.02, w.y0, w.y1, w.z0, w.z1, "url(#glassR)"),
    );
  // The roof's shadow along the top of the front.
  house.push(front(8.03, 0, 10, L - 0.5, L, "#1b1f2a", { fillOpacity: 0.12 }));

  // The skillion: a thin slab from the back down to its overhang at the front, ribbed, with the panels on it.
  const [x0, x1, yb, yf, t] = [-0.5, 10.5, -0.6, 8.8, 0.22];
  roof.push(
    poly(
      [
        [x0, yf, roofAt(yf)],
        [x1, yf, roofAt(yf)],
        [x1, yf, roofAt(yf) + t],
        [x0, yf, roofAt(yf) + t],
      ],
      RF.back,
    ),
    poly(
      [
        [x1, yb, roofAt(yb)],
        [x1, yf, roofAt(yf)],
        [x1, yf, roofAt(yf) + t],
        [x1, yb, roofAt(yb) + t],
      ],
      RF.side,
    ),
    poly(
      [
        [x0, yb, roofAt(yb) + t],
        [x1, yb, roofAt(yb) + t],
        [x1, yf, roofAt(yf) + t],
        [x0, yf, roofAt(yf) + t],
      ],
      RF.face,
    ),
  );
  for (let x = x0 + 0.4; x < x1; x += 0.4)
    roof.push(ln([x, yb, roofAt(yb) + t], [x, yf, roofAt(yf) + t], { stroke: RF.line, strokeWidth: 1 }));
  const slope = Math.hypot(yf - yb, roofAt(yb) - roofAt(yf));
  const at = (u: number, v: number): P3 => {
    const y = yb + ((yf - yb) * v) / slope;
    return [u, y, roofAt(y) + t + 0.1];
  };
  roof.push(
    ...panelRows(
      at,
      rowsDown(0.5, slope - 0.6, 1.6, () => [0.1, 9.9]),
      l.options.panels,
    ).kids,
  );
  roof.push(
    ln([x0, yf, roofAt(yf) + t], [x1, yf, roofAt(yf) + t], { stroke: "#ffffff", strokeOpacity: 0.5, strokeWidth: 1.5 }),
  );
  // Downlights under the overhang.
  const lights: P3[] = [4.6, 6.6, 8.6].map((x) => [x, 8.5, roofAt(8.5) - 0.05]);
  for (const p of lights) {
    const q = I(...p);
    roof.push(h("circle", { cx: q[0], cy: q[1], r: 1.3, fill: "#d8d8d8" }));
  }

  // The deck out the front of the glass, a step down at its edge.
  const d = c.deck;
  roof.push(
    flat(d.x0, d.x1, 8, d.y1, d.z, DECK),
    front(d.y1, d.x0, d.x1, 0, d.z, "#9d7b51"),
    side(d.x1, 8, d.y1, 0, d.z, "#8c6c45"),
  );
  for (let x = d.x0 + 0.25; x < d.x1; x += 0.25)
    roof.push(ln([x, 8, d.z + 0.01], [x, d.y1, d.z + 0.01], { stroke: "rgba(90,55,20,0.14)", strokeWidth: 0.8 }));

  night.push(...litFront(8, 3.9, 9.6, 0.3, glassTop, true), front(8.05, 0.8, 1.25, 0.2, 2.6, LIT));
  if (floor)
    night.push(...litFront(8, 0.9, 3.0, floor + 0.7, L - 0.45), ...litFront(8, 3.9, 9.6, floor + 0.5, L - 0.45));
  night.push(
    poly(
      [cl(0.8, 0.25), cl(5.4, 0.25), cl(5.4, 0.85), cl(0.8, 0.85)].map((p) => [p[0] + 0.01, p[1], p[2]] as P3),
      LIT,
    ),
  );
  for (const w of l.sideWindows) night.push(side(10.04, w.y0, w.y1, w.z0, w.z1, LIT));
  for (const p of lights) {
    const q = I(...p);
    night.push(
      h("ellipse", { cx: q[0], cy: q[1] + 14, rx: 12, ry: 20, fill: WARM, fillOpacity: 0.15 }),
      h("circle", { cx: q[0], cy: q[1], r: 2, fill: "#fff3cf" }),
    );
  }

  return {
    house,
    roof,
    night,
    yard: [
      ...[0.4, 0.9, 3.3].map((x) => shrub(x, 8.5, 5, "#b3bf8f")),
      ...[0.5, 1.0, 2.9, 3.4].map((x) => shrub(x, 9.4, 3.5, "#c9c38f")),
    ],
    trees: [[0.2, 10.4, 19]],
    paths: [
      flat(1.4, 2.4, 8, l.ground.y1, 0.01, "#e8e3d8"),
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

export const coastal: Style = {
  draw,
  look: { walls: "boards_white", roof: "shale", fence: "none", garden: "native" },
};
