import { h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { farmhouseLevels, type Layout } from "~/features/overview/utils/house/layout";
import {
  flat,
  front,
  frontWall,
  LIT,
  litFront,
  lookOf,
  meterBox,
  panelRows,
  porchLight,
  rowsDown,
  shrub,
  side,
  sideGable,
  sideWall,
  WARM,
  type Style,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The farmhouse: charcoal board-and-batten cladding under a steep standing-seam gable roof, a tall
 * triangle of glass in the gable end, a cedar panel around a black front door, black-framed sliding
 * doors onto a timber deck under a pergola, and lavender and an olive tree in the garden.
 */

const CEDAR = "#b67d4f";
const BLACK = "#1f2125";
const DECK = "#b08a5f";

/** A black-framed window or glass door on the street side, with mullions. */
function blackFront(y: number, x0: number, x1: number, z0: number, z1: number, panes: number): Kid[] {
  const out: Kid[] = [
    front(y + 0.01, x0 - 0.1, x1 + 0.1, z0 - 0.1, z1 + 0.1, BLACK),
    front(y + 0.02, x0, x1, z0, z1, "url(#glassL)"),
  ];
  for (let i = 1; i < panes; i++) {
    const x = x0 + ((x1 - x0) * i) / panes;
    out.push(ln([x, y + 0.03, z0], [x, y + 0.03, z1], { stroke: BLACK, strokeWidth: 2.2 }));
  }
  return out;
}

function draw(l: Layout): StyleParts {
  const { wallTop: W, eave: E, ridge: R, floor } = farmhouseLevels(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, farmhouse.look);
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const doorTop = floor ? floor - 0.4 : W - 0.6;
  const slope = Math.hypot(4.4, R - E);
  /** A point just above the street-side roof plane: u along the ridge, v down the slope from it. */
  const plane = (u: number, v: number): P3 => [u, 4 + (4.4 * v) / slope - 0.05, R - ((R - E) * v) / slope + 0.1];

  // The back slope, the cladding, and the gable end with its glass.
  house.push(
    poly(
      [
        [-0.3, 4, R],
        [10.3, 4, R],
        [10.3, -0.4, E],
        [-0.3, -0.4, E],
      ],
      RF.back,
    ),
    ...sideWall(walls, 10, 0, 8, 0, W),
    ...sideGable(walls, 10, 0, 8, W, 4, R),
    poly(
      [
        [10.02, 1.7, W + 0.35],
        [10.02, 6.3, W + 0.35],
        [10.02, 4, R - 0.9],
      ],
      BLACK,
    ),
    poly(
      [
        [10.03, 1.95, W + 0.45],
        [10.03, 6.05, W + 0.45],
        [10.03, 4, R - 1.15],
      ],
      "url(#glassR)",
    ),
    ln([10.04, 4, W + 0.45], [10.04, 4, R - 1.15], { stroke: BLACK, strokeWidth: 2 }),
    ...frontWall(walls, 8, 0, 10, 0, W),
  );
  // A cedar panel round the black front door; glass doors (and windows upstairs) across the rest.
  house.push(
    front(8.02, 0.4, 3.6, 0, floor ?? W, CEDAR),
    ...Array.from({ length: Math.floor((floor ?? W) / 0.18) }, (_, i) =>
      ln([0.4, 8.03, (i + 1) * 0.18], [3.6, 8.03, (i + 1) * 0.18], { stroke: "rgba(80,40,10,0.18)", strokeWidth: 0.8 }),
    ),
    front(8.03, 1.5, 2.5, 0, Math.min(2.8, doorTop), BLACK),
    ln([2.35, 8.04, 0.9], [2.35, 8.04, 1.9], { stroke: "#c9a96b", strokeWidth: 2 }),
    meterBox(8.01, 0.6, 2.0),
    ...blackFront(8, 4.2, 9.4, 0.1, Math.min(2.9, doorTop), 4),
  );
  if (floor)
    house.push(
      front(8.01, 0, 10, floor - 0.08, floor + 0.08, BLACK),
      side(10.01, 0, 8, floor - 0.08, floor + 0.08, BLACK),
      ...blackFront(8, 0.9, 3.1, floor + 0.9, floor + 2.6, 2),
      ...blackFront(8, 4.3, 6.1, floor + 0.9, floor + 2.6, 2),
      ...blackFront(8, 7.3, 9.1, floor + 0.9, floor + 2.6, 2),
    );
  for (const w of l.sideWindows)
    house.push(
      side(10.01, w.y0 - 0.1, w.y1 + 0.1, w.z0 - 0.1, w.z1 + 0.1, BLACK),
      side(10.02, w.y0, w.y1, w.z0, w.z1, "url(#glassR)"),
    );

  // The street-side slope: standing seams down it, all-black panels in two rows, a black fascia.
  roof.push(
    poly(
      [
        [-0.3, 4, R],
        [10.3, 4, R],
        [10.3, 8.4, E],
        [-0.3, 8.4, E],
      ],
      RF.face,
    ),
  );
  for (let x = 0; x < 10.3; x += 0.4) roof.push(ln([x, 4, R], [x, 8.4, E], { stroke: RF.line, strokeWidth: 1 }));
  roof.push(
    ...panelRows(
      plane,
      rowsDown(0.35, slope - 0.35, 1.6, () => [0.2, 9.8]),
      l.options.panels,
    ).kids,
  );
  roof.push(
    ln([-0.3, 4, R], [10.3, 4, R], { stroke: RF.cap, strokeWidth: 3.5 }),
    ln([-0.3, 8.4, E], [10.3, 8.4, E], { stroke: BLACK, strokeWidth: 3 }),
    ln([10.3, 4, R], [10.3, 8.4, E], { stroke: BLACK, strokeWidth: 3 }),
    ln([10.3, 4, R], [10.3, -0.4, E], { stroke: BLACK, strokeWidth: 3 }),
  );

  // The deck and pergola out the front of the glass doors.
  const deck = { x0: 4.0, x1: 9.8, y0: 8, y1: 9.8, z: 0.18 };
  roof.push(
    flat(deck.x0, deck.x1, deck.y0, deck.y1, deck.z, DECK),
    front(deck.y1, deck.x0, deck.x1, 0, deck.z, "#957249"),
    side(deck.x1, deck.y0, deck.y1, 0, deck.z, "#86663f"),
  );
  for (let x = deck.x0 + 0.3; x < deck.x1; x += 0.3)
    roof.push(
      ln([x, deck.y0, deck.z + 0.01], [x, deck.y1, deck.z + 0.01], { stroke: "rgba(80,50,20,0.15)", strokeWidth: 0.8 }),
    );
  const beam = 3.05;
  for (const x of [deck.x0 + 0.1, (deck.x0 + deck.x1) / 2, deck.x1 - 0.1])
    roof.push(ln([x, deck.y1 - 0.1, deck.z], [x, deck.y1 - 0.1, beam], { stroke: BLACK, strokeWidth: 3 }));
  roof.push(
    ln([deck.x0 - 0.2, deck.y1 - 0.1, beam], [deck.x1 + 0.2, deck.y1 - 0.1, beam], { stroke: BLACK, strokeWidth: 3 }),
  );
  for (let x = deck.x0; x <= deck.x1 + 0.01; x += 0.58)
    roof.push(ln([x, 8.02, beam], [x, deck.y1 + 0.1, beam], { stroke: BLACK, strokeWidth: 2 }));
  const light = porchLight([3.0, 8.04, 2.5]);
  roof.push(...light.lamp);

  // At night the glass glows, the gable window too, and festoon lights hang across the pergola.
  night.push(...litFront(8, 4.2, 9.4, 0.1, Math.min(2.9, doorTop), true));
  if (floor)
    for (const [a, b] of [
      [0.9, 3.1],
      [4.3, 6.1],
      [7.3, 9.1],
    ])
      night.push(...litFront(8, a, b, floor + 0.9, floor + 2.6));
  night.push(
    poly(
      [
        [10.03, 1.95, W + 0.45],
        [10.03, 6.05, W + 0.45],
        [10.03, 4, R - 1.15],
      ],
      LIT,
    ),
    ...l.sideWindows.map((w) => side(10.04, w.y0, w.y1, w.z0, w.z1, LIT)),
    ...light.glow,
  );
  for (let x = deck.x0 + 0.4; x < deck.x1; x += 0.55) {
    const c = I(x, deck.y1 - 0.4, beam - 0.25);
    night.push(
      h("circle", { cx: c[0], cy: c[1], r: 1.8, fill: WARM }),
      h("circle", { cx: c[0], cy: c[1], r: 5, fill: WARM, fillOpacity: 0.2 }),
    );
  }

  return {
    house,
    roof,
    night,
    yard: [...[0.5, 0.95, 1.4, 2.6, 3.05, 3.5].map((x) => shrub(x, 8.5, 4.5, "#a98bc4"))],
    trees: [[0.3, 10.2, 17]],
    paths: [
      flat(1.5, 2.5, 8, l.ground.y1, 0.01, "#d9d6cf"),
      poly(
        [
          [0, 8, 0.02],
          [10, 8, 0.02],
          [10.6, 10.4, 0.02],
          [0.6, 10.4, 0.02],
        ],
        "rgba(30,40,30,0.09)",
      ),
    ],
  };
}

export const farmhouse: Style = {
  draw,
  look: { walls: "cladding_charcoal", roof: "night_sky", fence: "none", garden: "leafy" },
};
