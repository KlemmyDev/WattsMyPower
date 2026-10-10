import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { bungalowLevels, type Layout } from "~/features/overview/utils/house/layout";
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
 * The Californian bungalow: dark brick under a low gable facing the street, roughcast and timber battens in the
 * gable, a deep porch under its own gable on tapered piers, a wide window of leadlit casements, and the panels on
 * the roof's long side.
 */

const ROUGHCAST = "#efe8da";
const TIMBER = "#5b4636";
const TRIM = "#f6f1e6";

/** A gable end facing the street in roughcast, with timber battens and a little vent at its peak. */
function gableEnd(y: number, x0: number, x1: number, z0: number, xp: number, z1: number): Kid[] {
  const out: Kid[] = [
    poly(
      [
        [x0, y, z0],
        [x1, y, z0],
        [xp, y, z1],
      ],
      ROUGHCAST,
    ),
  ];
  const top = (x: number) => z0 + (z1 - z0) * (x < xp ? (x - x0) / (xp - x0) : (x1 - x) / (x1 - xp));
  for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.45)
    out.push(ln([x, y + 0.01, z0], [x, y + 0.01, top(x) - 0.05], { stroke: TIMBER, strokeWidth: 1.6 }));
  out.push(front(y + 0.01, x0, x1, z0, z0 + 0.15, TIMBER));
  return out;
}

function draw(l: Layout): StyleParts {
  const b = bungalowLevels(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, bungalow.look);
  const two = l.options.storeys === 2;
  const { wallTop: W, ridge: Rg, eaves: E, porch: P } = b;
  const We = W - 0.25; // the eaves' edge, a little below the wall's top
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const floors = two ? [0, 3.3] : [0];

  // The roof's far slope (it shows over the ridge, the roof being low), then the walls and the gable end.
  house.push(
    poly(
      [
        [E.x0, E.y0, We],
        [E.x0, E.y1, We],
        [5, E.y1, Rg],
        [5, E.y0, Rg],
      ],
      RF.back,
    ),
    ...sideWall(walls, 10, 0, 8, 0, W, { plinth: true }),
    ...frontWall(walls, 8, 0, 10, 0, W, true),
    ...gableEnd(8, 0, 10, W, 5, Rg - 0.35),
  );
  if (two) house.push(front(8.02, 0, 10, 3.2, 3.35, TRIM), side(10.02, 0, 8, 3.2, 3.35, TRIM));
  // The wide window of casements on the right, leadlight across their tops; the door and a window behind the porch.
  for (const z of floors) {
    house.push(...frontWindow(8, 5.9, 9.4, z + 1.0, z + 2.7, { frame: TRIM }));
    for (const x of [7.07, 8.23])
      house.push(ln([x, 8.05, z + 1.0], [x, 8.05, z + 2.7], { stroke: TRIM, strokeWidth: 2.2 }));
    house.push(front(8.05, 5.9, 9.4, z + 2.25, z + 2.7, "#cf9d57", { fillOpacity: 0.8 }));
  }
  house.push(
    front(8.02, 2.25, 3.35, 0.35, 2.9, TRIM, { stroke: "#cfc8bb", strokeWidth: 0.8 }),
    front(8.03, 2.4, 3.2, 0.35, 2.8, "#4a3a2c"),
    front(8.03, 2.55, 3.05, 1.7, 2.6, "#cf9d57", { fillOpacity: 0.85 }),
    ...frontWindow(8, 0.8, 1.8, 1.1, 2.6, { frame: TRIM }),
    ...(two ? frontWindow(8, 1.0, 4.4, 4.3, 5.9, { frame: TRIM }) : []),
    meterBox(8, 4.15, 1.4),
  );
  for (const w of l.sideWindows) house.push(...sideWindow(10, w.y0, w.y1, w.z0, w.z1, TRIM));
  house.push(...eaveShadow.side(10, 0, 8, W));

  // The main roof's long side, in rows of tiles, with the panels on it.
  roof.push(
    poly(
      [
        [5, E.y0, Rg],
        [5, E.y1, Rg],
        [E.x1, E.y1, We],
        [E.x1, E.y0, We],
      ],
      RF.side,
    ),
  );
  const slope = Math.hypot(E.x1 - 5, Rg - We);
  const at = (u: number, v: number): P3 => [5 + ((E.x1 - 5) * v) / slope + 0.05, u, Rg - ((Rg - We) * v) / slope + 0.1];
  for (let v = 0.45; v < slope; v += 0.45) roof.push(ln(at(E.y0, v), at(E.y1, v), { stroke: RF.line, strokeWidth: 1 }));
  roof.push(
    ...panelRows(
      at,
      rowsDown(0.35, slope - 0.35, 1.55, () => [0.1, 8.0]),
      l.options.panels,
    ).kids,
  );
  // The front edge of the roof: its thickness along both rakes, the barge boards, and the ridge.
  const rake = (xa: number, za: number): Kid =>
    poly(
      [
        [xa, E.y1, za],
        [5, E.y1, Rg],
        [5, E.y1, Rg + 0.22],
        [xa, E.y1, za + 0.22],
      ],
      RF.back,
    );
  roof.push(
    rake(E.x0, We),
    rake(E.x1, We),
    ln([E.x0, E.y1 + 0.01, We + 0.02], [5, E.y1 + 0.01, Rg + 0.02], { stroke: TRIM, strokeWidth: 2.6 }),
    ln([5, E.y1 + 0.01, Rg + 0.02], [E.x1, E.y1 + 0.01, We + 0.02], { stroke: TRIM, strokeWidth: 2.6 }),
    ln([5, E.y0, Rg + 0.22], [5, E.y1, Rg + 0.22], { stroke: RF.cap, strokeWidth: 3 }),
    ln([E.x1, E.y0, We - 0.05], [E.x1, E.y1, We - 0.05], { stroke: "#ddd7cc", strokeWidth: 2.4 }),
  );

  // The porch: its floor and steps, the piers (brick bases, tapering render above), the beam, and its gable roof.
  const zf = 0.35;
  roof.push(
    flat(P.x0, P.x1, 8, P.y1, zf, "#c9bfae"),
    front(P.y1, P.x0, P.x1, 0, zf, walls.plinth),
    side(P.x1, 8, P.y1, 0, zf, shade(walls.plinth, -0.08)),
  );
  for (const [x, top] of [
    [P.x0 + 0.05, zf],
    [P.x1 - 0.65, zf],
  ]) {
    // brick base, then a column narrowing to the beam
    roof.push(...box(x, x + 0.6, P.y1 - 0.65, P.y1 - 0.05, top, 1.2, walls.face, walls.side, walls.face));
    roof.push(
      poly(
        [
          [x + 0.05, P.y1 - 0.1, 1.2],
          [x + 0.55, P.y1 - 0.1, 1.2],
          [x + 0.45, P.y1 - 0.1, P.beam - 0.3],
          [x + 0.15, P.y1 - 0.1, P.beam - 0.3],
        ],
        TRIM,
      ),
      poly(
        [
          [x + 0.55, P.y1 - 0.1, 1.2],
          [x + 0.55, P.y1 - 0.6, 1.2],
          [x + 0.45, P.y1 - 0.5, P.beam - 0.3],
          [x + 0.45, P.y1 - 0.2, P.beam - 0.3],
        ],
        shade(TRIM, -0.1),
      ),
    );
  }
  roof.push(...box(P.x0 - 0.1, P.x1 + 0.1, P.y1 - 0.4, P.y1, P.beam - 0.35, P.beam, TRIM, shade(TRIM, -0.1), TRIM));
  const px = (P.x0 + P.x1) / 2;
  const [py1, pe] = [P.y1 + 0.3, P.beam - 0.05];
  roof.push(
    poly(
      [
        [P.x0 - 0.3, 8, pe],
        [P.x0 - 0.3, py1, pe],
        [px, py1, P.peak],
        [px, 8, P.peak],
      ],
      RF.back,
    ),
    ...gableEnd(P.y1, P.x0 - 0.1, P.x1 + 0.1, P.beam, px, P.peak - 0.3),
    poly(
      [
        [px, 8, P.peak],
        [px, py1, P.peak],
        [P.x1 + 0.3, py1, pe],
        [P.x1 + 0.3, 8, pe],
      ],
      RF.side,
    ),
  );
  const pAt = (u: number, v: number): P3 => [px + (P.x1 + 0.3 - px) * v, u, P.peak - (P.peak - pe) * v];
  for (let v = 0.2; v < 1; v += 0.2) roof.push(ln(pAt(8, v), pAt(py1, v), { stroke: RF.line, strokeWidth: 1 }));
  roof.push(
    ln([P.x0 - 0.3, py1 + 0.01, pe], [px, py1 + 0.01, P.peak], { stroke: TRIM, strokeWidth: 2.6 }),
    ln([px, py1 + 0.01, P.peak], [P.x1 + 0.3, py1 + 0.01, pe], { stroke: TRIM, strokeWidth: 2.6 }),
    ln([px, 8, P.peak], [px, py1, P.peak], { stroke: RF.cap, strokeWidth: 2.6 }),
  );
  for (let i = 0; i < 2; i++)
    roof.push(
      ...box(
        px - 0.6,
        px + 0.6,
        P.y1 + i * 0.3,
        P.y1 + (i + 1) * 0.3,
        0,
        zf - (i + 1) * 0.12 + 0.12,
        "#d3c9b8",
        "#b3a995",
        "#c4baa8",
      ),
    );
  const light = porchLight([px + 0.9, 8.05, 2.4]);
  roof.push(...light.lamp);

  for (const z of floors) night.push(...litFront(8, 5.9, 9.4, z + 1.0, z + 2.7, z === 0));
  night.push(...litFront(8, 0.8, 1.8, 1.1, 2.6), front(8.05, 2.55, 3.05, 1.7, 2.6, LIT));
  if (two) night.push(...litFront(8, 1.0, 4.4, 4.3, 5.9));
  for (const w of l.sideWindows) night.push(side(10.04, w.y0, w.y1, w.z0, w.z1, LIT));
  night.push(...light.glow);
  {
    // a warm wash under the porch
    const c = I(px, 9.2, 0.4);
    night.push(h("ellipse", { cx: c[0], cy: c[1], rx: 50, ry: 18, fill: "#ffd27f", fillOpacity: 0.14 }));
  }

  return {
    house,
    roof,
    night,
    yard: [
      ...[5.6, 6.4, 7.2, 8.0, 8.8, 9.5].map((x) => shrub(x, 8.5, 6, "#94b682")),
      ...[6.0, 7.6, 9.1].map((x) => shrub(x, 8.6, 2.3, "#f0d36e")),
    ],
    trees: [[8.6, 10.3, 21]],
    paths: [
      flat(px - 0.6, px + 0.6, P.y1 + 0.6, l.ground.y1, 0.01, "#ddd3c2"),
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

export const bungalow: Style = {
  draw,
  look: { walls: "brick_brown", roof: "terracotta", fence: "hedge", garden: "leafy" },
};
