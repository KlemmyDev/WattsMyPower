import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { NEIGHBOUR, townhouseLevels, type Layout } from "~/features/overview/utils/house/layout";
import { shade, type Finish } from "~/features/overview/utils/house/palette";
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
  sideWall,
  type Style,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The townhouse: one half of a pair. Rendered below and clad in timber above, the upper floor set back behind a
 * balcony with a glass balustrade, under a skillion roof falling to the street, a fire wall standing between the two
 * halves. Its neighbour joins on the left, fading out of the picture. A single-storey one is a villa unit.
 */

const FRAME = "#33373d";
/** The timber cladding upstairs. */
const TIMBER: Finish = {
  name: "Timber",
  material: "battens",
  face: "#a47550",
  side: "#8c6343",
  plinth: "#7a5639",
  line: "#b8885f",
};

/** Glass in a dark frame on a wall facing the street, split into `panes`. */
function glass(y: number, x0: number, x1: number, z0: number, z1: number, panes = 2): Kid[] {
  const out: Kid[] = [
    front(y + 0.01, x0 - 0.08, x1 + 0.08, z0 - 0.08, z1 + 0.08, FRAME),
    front(y + 0.02, x0, x1, z0, z1, "url(#glassL)"),
  ];
  for (let i = 1; i < panes; i++) {
    const x = x0 + ((x1 - x0) * i) / panes;
    out.push(ln([x, y + 0.03, z0], [x, y + 0.03, z1], { stroke: FRAME, strokeWidth: 1.8 }));
  }
  return out;
}

function draw(l: Layout): StyleParts {
  const t = townhouseLevels(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, townhouse.look);
  const { lower: Lz, upper: U, front: F, roofAt } = t;
  const night: Kid[] = [];
  const yb = -0.5;
  const yf = F + 0.35;

  /** One half, from x0 to x1: its walls, windows, balcony and roof, with its door at `door` (x). `ours` has the
   * panels, the right side and the meter. */
  function half(x0: number, x1: number, door: number, ours: boolean): { walls: Kid[]; roof: Kid[] } {
    const w: Kid[] = [];
    const r: Kid[] = [];
    const wide = x1 - x0;
    const win = door < (x0 + x1) / 2 ? [door + 1.6, x1 - 0.8] : [x0 + 0.8, door - 0.6];
    if (ours) w.push(...sideWall(walls, x1, 0, 8, 0, Lz, { plinth: true }));
    w.push(...frontWall(walls, 8, x0, x1, 0, Lz, true));
    w.push(
      front(8.02, door, door + 1.0, 0, 2.5, "#3a3029"),
      ln([door + 0.85, 8.03, 0.9], [door + 0.85, 8.03, 1.8], { stroke: "#d6d9dc", strokeWidth: 2 }),
      front(8.02, door - 0.35, door - 0.08, 0, 2.5, "url(#glassL)", { stroke: FRAME, strokeWidth: 1 }),
      ...glass(8, win[0], win[1], 0.9, 2.6, wide > 7 ? 3 : 2),
    );
    if (ours) w.push(meterBox(8, door + 1.25, 1.6));
    if (U) {
      // The upper floor, set back, clad in timber; the balcony in front on the lower floor's roof.
      if (ours) w.push(...sideWall(TIMBER, x1, 0, U.y1, U.z0, roofAt(0), { z1b: roofAt(U.y1) }));
      w.push(
        ...frontWall(TIMBER, U.y1, x0, x1, U.z0, U.z1),
        ...glass(U.y1, x0 + 0.7, x0 + wide * 0.55, U.z0 + 0.15, U.z1 - 0.5, 2),
        ...glass(U.y1, x0 + wide * 0.62, x1 - 0.7, U.z0 + 1.0, U.z1 - 0.5, 1),
        flat(x0, x1, U.y1, 8.15, Lz + 0.18, "#d9d6cf"),
        front(8.15, x0, x1, Lz, Lz + 0.18, shade(walls.face, -0.06)),
      );
      if (ours) w.push(side(x1, U.y1, 8.15, Lz, Lz + 0.18, shade(walls.side, -0.06)));
      w.push(
        front(8.1, x0 + 0.2, x1 - 0.2, Lz + 0.18, Lz + 1.2, "#dceaf3", {
          fillOpacity: 0.35,
          stroke: "#9fb4c4",
          strokeWidth: 0.8,
        }),
        ln([x0 + 0.2, 8.1, Lz + 1.2], [x1 - 0.2, 8.1, Lz + 1.2], { stroke: "#c7d1d8", strokeWidth: 1.6 }),
      );
    }
    // The skillion: a thin slab from the back down to its overhang at the front.
    const top = (y: number) => roofAt(y) + 0.2;
    r.push(
      poly(
        [
          [x0, yf, roofAt(yf)],
          [x1 + 0.3, yf, roofAt(yf)],
          [x1 + 0.3, yf, top(yf)],
          [x0, yf, top(yf)],
        ],
        RF.back,
      ),
      ...(ours
        ? [
            poly(
              [
                [x1 + 0.3, yb, roofAt(yb)],
                [x1 + 0.3, yf, roofAt(yf)],
                [x1 + 0.3, yf, top(yf)],
                [x1 + 0.3, yb, top(yb)],
              ],
              RF.side,
            ),
          ]
        : []),
      poly(
        [
          [x0, yb, top(yb)],
          [x1 + 0.3, yb, top(yb)],
          [x1 + 0.3, yf, top(yf)],
          [x0, yf, top(yf)],
        ],
        RF.face,
      ),
    );
    for (let x = x0 + 0.4; x < x1 + 0.3; x += 0.4)
      r.push(ln([x, yb, top(yb)], [x, yf, top(yf)], { stroke: RF.line, strokeWidth: 1 }));
    if (ours) {
      const slope = Math.hypot(yf - yb, top(yb) - top(yf));
      const at = (u: number, v: number): P3 => {
        const y = yb + ((yf - yb) * v) / slope;
        return [u, y, top(y) + 0.1];
      };
      r.push(
        ...panelRows(
          at,
          rowsDown(0.4, slope - 0.4, 1.6, () => [x0 + 0.6, x1 - 0.2]),
          l.options.panels,
        ).kids,
      );
    }
    return { walls: w, roof: r };
  }

  const mine = half(0, 10, 6.6, true);
  const theirs = half(-NEIGHBOUR, 0, -NEIGHBOUR + 1.4, false);
  // The fire wall between the halves: up through the roof and out past the front (down to the balcony, upstairs).
  // Only what stands above our roof shows.
  const fireTop = (y: number) => roofAt(y) + 0.55;
  const roofTop = (y: number) => roofAt(y) + 0.2;
  const fy1 = (U ? U.y1 : 8) + 0.5;
  const base = U ? Lz + 0.18 : 0;
  const fire: Kid[] = [
    poly(
      [
        [0.15, yb, roofTop(yb)],
        [0.15, yf, roofTop(yf)],
        [0.15, yf, base],
        [0.15, fy1, base],
        [0.15, fy1, fireTop(fy1)],
        [0.15, yb, fireTop(yb)],
      ],
      shade(walls.side, -0.04),
    ),
    front(fy1, -0.15, 0.15, base, fireTop(fy1), walls.face),
    poly(
      [
        [-0.15, yb, fireTop(yb)],
        [0.15, yb, fireTop(yb)],
        [0.15, fy1, fireTop(fy1)],
        [-0.15, fy1, fireTop(fy1)],
      ],
      shade(walls.face, 0.1),
    ),
  ];

  // The neighbour fades out to the left, so it reads as next door rather than part of the house.
  const fade = h(
    "mask",
    { id: "nbFade", maskUnits: "userSpaceOnUse", x: -400, y: -200, width: 1600, height: 1000 },
    h(
      "linearGradient",
      {
        id: "nbFadeGrad",
        gradientUnits: "userSpaceOnUse",
        x1: I(-NEIGHBOUR, 8)[0],
        y1: 0,
        x2: I(-1, 8)[0] + 40,
        y2: 0,
      },
      h("stop", { offset: "0", stopColor: "#fff", stopOpacity: 0 }),
      h("stop", { offset: "1", stopColor: "#fff", stopOpacity: 1 }),
    ),
    h("rect", { x: -400, y: -200, width: 1600, height: 1000, fill: "url(#nbFadeGrad)" }),
  );
  const neighbour = h("g", { mask: "url(#nbFade)", opacity: 0.92 }, ...theirs.walls, ...theirs.roof);

  const light = porchLight([6.3, 8.04, 2.4]);
  const winL = [6.6 + 1.6, 10 - 0.8];
  night.push(...litFront(8, winL[0], winL[1], 0.9, 2.6, true), front(8.05, 6.25, 6.52, 0, 2.5, LIT));
  if (U)
    night.push(
      ...litFront(U.y1, 0.7, 5.5, U.z0 + 0.15, U.z1 - 0.5),
      ...litFront(U.y1, 6.2, 9.3, U.z0 + 1.0, U.z1 - 0.5),
    );
  for (const w of l.sideWindows) night.push(side(10.04, w.y0, w.y1, w.z0, w.z1, LIT));
  night.push(...light.glow);

  const sideWins: Kid[] = l.sideWindows.flatMap((w) => [
    side(10.01, w.y0 - 0.08, w.y1 + 0.08, w.z0 - 0.08, w.z1 + 0.08, FRAME),
    side(10.02, w.y0, w.y1, w.z0, w.z1, "url(#glassR)"),
  ]);

  return {
    house: [h("defs", {}, fade), neighbour, ...mine.walls, ...sideWins],
    roof: [...mine.roof, ...fire, ...light.lamp, ...box(9.0, 9.3, 9.6, 9.9, 0, 1.2, "#3b3f45", "#2e3136", "#44484f")],
    night,
    yard: [
      ...[0.5, 1.2, 1.9, 2.6, 3.3, 4.0].map((x) => shrub(x, 8.5, 5.5, "#8fb07c")),
      ...[-5.2, -4.4, -3.6, -2.8].map((x) => shrub(x, 8.5, 5, "#a7c296")),
    ],
    trees: [[2.6, 10.0, 18]],
    paths: [
      flat(6.6, 7.6, 8, l.ground.y1, 0.01, "#e4e2dc"),
      flat(-NEIGHBOUR + 1.4, -NEIGHBOUR + 2.4, 8, l.ground.y1, 0.01, "#e4e2dc", { fillOpacity: 0.6 }),
      poly(
        [
          [-NEIGHBOUR, 8, 0.02],
          [10, 8, 0.02],
          [10.6, 10.4, 0.02],
          [-NEIGHBOUR + 0.6, 10.4, 0.02],
        ],
        "rgba(30,40,30,0.08)",
      ),
    ],
  };
}

export const townhouse: Style = {
  draw,
  look: { walls: "render_white", roof: "monument", fence: "slat", garden: "leafy" },
};
