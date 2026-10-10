import { box, ln, poly, type Attrs, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { queenslanderLevels, type Layout } from "~/features/overview/utils/house/layout";
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
 * The Queenslander: weatherboards up on stumps with lattice between them (or built in underneath, when it's
 * two storeys), a hip roof of galvanised iron with the panels on its street side, and a verandah across the
 * front under its own skirt of iron, with white posts, railings and frieze, and timber stairs down to the
 * garden.
 */

const TIMBER = "#b8976d";
const TRIM = "#ffffff";

/** Diagonal lattice across a rectangle on a plane: `at(u, z)` gives the point at u along it and z up it. */
function lattice(at: (u: number, z: number) => P3, u0: number, u1: number, z0: number, z1: number): Kid[] {
  const out: Kid[] = [];
  const step = 0.42;
  const stroke: Attrs = { stroke: "#ffffff", strokeWidth: 1.4, strokeOpacity: 0.9 };
  for (let c = u0 - (z1 - z0); c < u1; c += step) {
    // u - z = c - z0 (rising) and u + z = c + z1 (falling), each clipped to the rectangle
    const rise = [Math.max(z0, u0 - c + z0), Math.min(z1, u1 - c + z0)];
    if (rise[0] < rise[1]) out.push(ln(at(c - z0 + rise[0], rise[0]), at(c - z0 + rise[1], rise[1]), stroke));
    const k = c + (z1 - z0);
    const fall = [Math.max(z0, z0 + (k - u1)), Math.min(z1, z0 + (k - u0))];
    if (fall[0] < fall[1]) out.push(ln(at(k - (fall[0] - z0), fall[0]), at(k - (fall[1] - z0), fall[1]), stroke));
  }
  return out;
}

function draw(l: Layout): StyleParts {
  const q = queenslanderLevels(l.options.storeys);
  const { floor: F, wallTop: W, ridge: R, front: Y, deck: D } = q;
  const { walls, roof: RF } = lookOf(l, queenslander.look);
  const IRON = RF.face;
  const IRON_SIDE = RF.side;
  const RIB: Attrs = { stroke: RF.line, strokeWidth: 1 };
  const under = shade(walls.face, 0.25); // the lattice's backing and the built-in floor, paler than the walls
  const two = l.options.storeys === 2;
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const stairs = { x0: 4.4, x1: 5.6 };
  const stairEnd = D + q.steps * 0.28;
  const veranda = { high: W - 0.25, low: W - 1.05, y0: Y + 0.5, y1: D + 0.25 };

  // Underneath: lattice between the stumps, or the built-in lower floor.
  if (two) {
    house.push(side(10, 0, Y, 0, F, shade(under, -0.05)), front(Y, 0, 10, 0, F, under));
    house.push(...frontWindow(Y, 1.2, 3.2, 0.9, 2.4), ...frontWindow(Y, 7.0, 9.0, 0.9, 2.4));
    house.push(front(Y + 0.02, 4.5, 5.5, 0, 2.4, "#ffffff", { stroke: "#cfc8bb", strokeWidth: 0.8 }));
    house.push(front(Y + 0.03, 4.6, 5.4, 0, 2.3, "#7c6a55"));
  } else {
    house.push(side(10, 0, Y, 0, F - 0.15, "#e9e2d3"));
    house.push(...lattice((u, z) => [10.01, u, z], 0, Y, 0, F - 0.15));
  }

  // The weatherboard walls, with white corner boards, the front door with its fanlight, and the meter.
  house.push(
    ...sideWall(walls, 10, 0, Y, F, W),
    ...frontWall(walls, Y, 0, 10, F, W),
    ...eaveShadow.side(10, 0, Y, W),
    ln([10, Y, F], [10, Y, W], { stroke: TRIM, strokeWidth: 3 }),
    ln([10.01, 0, F], [10.01, Y, F], { stroke: TRIM, strokeWidth: 2.5 }),
    ...frontWindow(Y, 1.0, 2.8, F + 0.9, F + 2.6),
    ...frontWindow(Y, 7.2, 9.0, F + 0.9, F + 2.6),
    front(Y + 0.02, 4.35, 5.65, F, F + 3.05, TRIM, { stroke: "#cfc8bb", strokeWidth: 0.8 }),
    front(Y + 0.03, 4.5, 5.5, F, F + 2.55, "#4d6b5a"),
    front(Y + 0.03, 4.5, 5.5, F + 2.65, F + 2.95, "url(#glassL)"),
    meterBox(Y, 0.35, W - 1.4),
  );
  for (const w of l.sideWindows) house.push(...sideWindow(10, w.y0, w.y1, w.z0, w.z1));

  // The hip roof of iron: its street side and its right side, ribbed down the slope, the panels on the front.
  const E = { x0: -0.5, x1: 10.5, y0: -0.5, y1: Y + 0.5 };
  const ridge = { x0: 3.2, x1: 6.8, y: 3.5 };
  roof.push(
    poly(
      [
        [E.x0, E.y1, W],
        [E.x1, E.y1, W],
        [ridge.x1, ridge.y, R],
        [ridge.x0, ridge.y, R],
      ],
      IRON,
    ),
    poly(
      [
        [E.x1, E.y0, W],
        [E.x1, E.y1, W],
        [ridge.x1, ridge.y, R],
      ],
      IRON_SIDE,
    ),
  );
  /** The street side's hips: at height t (0 eave..1 ridge), the plane's x extent and y. */
  const hip = (t: number) => ({
    x0: E.x0 + (ridge.x0 - E.x0) * t,
    x1: E.x1 - (E.x1 - ridge.x1) * t,
    y: E.y1 - (E.y1 - ridge.y) * t,
    z: W + (R - W) * t,
  });
  for (let x = E.x0 + 0.3; x < E.x1; x += 0.32) {
    const t = x < ridge.x0 ? (x - E.x0) / (ridge.x0 - E.x0) : x > ridge.x1 ? (E.x1 - x) / (E.x1 - ridge.x1) : 1;
    const p = hip(t);
    roof.push(ln([x, E.y1, W], [x, p.y, p.z], RIB));
  }
  for (let y = E.y0 + 0.3; y < E.y1; y += 0.32) {
    const t = y > ridge.y ? (E.y1 - y) / (E.y1 - ridge.y) : (y - E.y0) / (ridge.y - E.y0);
    roof.push(ln([E.x1, y, W], [E.x1 - (E.x1 - ridge.x1) * t, y, W + (R - W) * t], RIB));
  }
  // Panels inside the hips: across the street side from its widest row up, then on the right side.
  const slope = Math.hypot(E.y1 - ridge.y, R - W);
  const front_ = (u: number, v: number): P3 => {
    const p = hip(1 - v / slope);
    return [u, p.y - 0.04, p.z + 0.1];
  };
  const onFront = panelRows(
    front_,
    rowsDown(0.2, slope - 0.12, 1.36, (v) => {
      const p = hip(1 - v / slope);
      return [p.x0 + 0.3, p.x1 - 0.3];
    }).reverse(),
    l.options.panels,
  );
  const sideSlope = Math.hypot(E.x1 - ridge.x1, R - W);
  const side_ = (u: number, v: number): P3 => {
    const t = 1 - v / sideSlope;
    return [E.x1 - (E.x1 - ridge.x1) * t + 0.04, u, W + (R - W) * t + 0.1];
  };
  const onSide = panelRows(
    side_,
    rowsDown(0.2, sideSlope - 0.12, 1.36, (v) => {
      const t = 1 - v / sideSlope;
      return [E.y0 + (ridge.y - E.y0) * t + 0.3, E.y1 - (E.y1 - ridge.y) * t - 0.3];
    }).reverse(),
    l.options.panels - onFront.placed,
  );
  roof.push(...onFront.kids, ...onSide.kids);
  roof.push(
    ln([ridge.x0, ridge.y, R], [ridge.x1, ridge.y, R], { stroke: RF.cap, strokeWidth: 2.5 }),
    ln([E.x0, E.y1, W], [ridge.x0, ridge.y, R], { stroke: RF.cap, strokeWidth: 2 }),
    ln([E.x1, E.y1, W], [ridge.x1, ridge.y, R], { stroke: RF.cap, strokeWidth: 2 }),
    ln([E.x1, E.y0, W], [ridge.x1, ridge.y, R], { stroke: shade(RF.cap, -0.08), strokeWidth: 2 }),
  );

  // The verandah, nearer the street than the garage: lattice under the deck, the deck, its stairs, then posts,
  // railings, frieze and its own skirt of iron.
  if (!two) {
    for (const [u0, u1] of [
      [0, stairs.x0],
      [stairs.x1, 10],
    ]) {
      roof.push(front(D, u0, u1, 0, F - 0.15, "#ece5d6"));
      roof.push(...lattice((u, z) => [u, D + 0.01, z], u0, u1, 0, F - 0.15));
    }
    roof.push(side(10, Y, D, 0, F - 0.15, "#e4ddcd"), ...lattice((u, z) => [10.01, u, z], Y, D, 0, F - 0.15));
  }
  roof.push(
    flat(0, 10, Y, D, F, TIMBER),
    front(D, 0, 10, F - 0.15, F, "#a3845e"),
    side(10, Y, D, F - 0.15, F, "#94764f"),
  );
  for (let i = 0; i < q.steps; i++) {
    const z = F - (i + 1) * q.rise;
    roof.push(
      ...box(
        stairs.x0,
        stairs.x1,
        D + i * 0.28,
        D + (i + 1) * 0.28,
        0,
        Math.max(z, 0.05),
        "#c4a57b",
        "#94764f",
        "#a3845e",
      ),
    );
  }
  for (const x of [stairs.x0, stairs.x1])
    roof.push(ln([x, D, F + 0.9], [x, stairEnd, 0.9], { stroke: TRIM, strokeWidth: 2.2 }));
  const posts = [0.15, 2.6, stairs.x0 - 0.15, stairs.x1 + 0.15, 7.4, 9.85];
  const rail = { y: D - 0.12, low: F + 0.15, high: F + 0.95 };
  for (const [a, b] of [
    [0.15, stairs.x0 - 0.15],
    [stairs.x1 + 0.15, 9.85],
  ]) {
    roof.push(ln([a, rail.y, rail.high], [b, rail.y, rail.high], { stroke: TRIM, strokeWidth: 2.5 }));
    roof.push(ln([a, rail.y, rail.low], [b, rail.y, rail.low], { stroke: TRIM, strokeWidth: 1.6 }));
    for (let x = a + 0.22; x < b; x += 0.22)
      roof.push(ln([x, rail.y, rail.low], [x, rail.y, rail.high], { stroke: TRIM, strokeWidth: 1.1 }));
  }
  roof.push(ln([9.88, Y, rail.high], [9.88, rail.y, rail.high], { stroke: TRIM, strokeWidth: 2.5 }));
  roof.push(ln([9.88, Y, rail.low], [9.88, rail.y, rail.low], { stroke: TRIM, strokeWidth: 1.6 }));
  for (let y = Y + 0.22; y < rail.y; y += 0.22)
    roof.push(ln([9.88, y, rail.low], [9.88, y, rail.high], { stroke: TRIM, strokeWidth: 1.1 }));
  const postTop = veranda.low + (veranda.high - veranda.low) * ((veranda.y1 - rail.y) / (veranda.y1 - veranda.y0));
  for (const x of posts)
    roof.push(ln([x, rail.y, two ? 0 : F], [x, rail.y, postTop], { stroke: TRIM, strokeWidth: 3.5 }));
  // The frieze: a white band of slats just under the verandah roof, between the posts.
  for (let i = 0; i < posts.length - 1; i++) {
    const [a, b] = [posts[i] + 0.1, posts[i + 1] - 0.1];
    roof.push(front(rail.y + 0.01, a, b, postTop - 0.38, postTop - 0.08, TRIM, { fillOpacity: 0.85 }));
    for (let x = a + 0.15; x < b; x += 0.15)
      roof.push(
        ln([x, rail.y + 0.02, postTop - 0.36], [x, rail.y + 0.02, postTop - 0.1], {
          stroke: "#d8d2c4",
          strokeWidth: 0.8,
        }),
      );
  }
  roof.push(
    poly(
      [
        [-0.4, veranda.y0, veranda.high],
        [10.4, veranda.y0, veranda.high],
        [10.4, veranda.y1, veranda.low],
        [-0.4, veranda.y1, veranda.low],
      ],
      IRON,
    ),
    poly(
      [
        [10.4, Y, veranda.high + 0.1],
        [10.4, veranda.y0, veranda.high],
        [10.4, veranda.y1, veranda.low],
        [10.4, veranda.y1, veranda.low - 0.12],
        [10.4, Y, veranda.high - 0.02],
      ],
      IRON_SIDE,
    ),
  );
  for (let x = -0.1; x < 10.4; x += 0.3)
    roof.push(ln([x, veranda.y0, veranda.high], [x, veranda.y1, veranda.low], RIB));
  roof.push(ln([-0.4, veranda.y1, veranda.low], [10.4, veranda.y1, veranda.low], { stroke: TRIM, strokeWidth: 2.5 }));

  // At night the windows glow behind the verandah, and its pendant light is on (hung just under the verandah's
  // front edge: the verandah roof hides the wall behind it, as it would from up here).
  const light = porchLight([5.0, D - 0.3, postTop - 0.55]);
  roof.push(...light.lamp);
  night.push(
    ...litFront(Y, 1.0, 2.8, F + 0.9, F + 2.6),
    ...litFront(Y, 7.2, 9.0, F + 0.9, F + 2.6),
    front(Y + 0.04, 4.5, 5.5, F + 2.65, F + 2.95, "#ffd27f"),
    ...l.sideWindows.map((w) => side(10.04, w.y0, w.y1, w.z0, w.z1, LIT)),
    ...(two ? [...litFront(Y, 1.2, 3.2, 0.9, 2.4, true), ...litFront(Y, 7.0, 9.0, 0.9, 2.4, true)] : []),
    ...light.glow,
  );

  return {
    house,
    roof,
    night,
    yard: [...[0.5, 1.3, 2.4, 3.4, 6.6, 7.6, 8.6, 9.5].map((x) => shrub(x, D + 0.45, 7, "#93b882"))],
    trees: [[0.9, stairEnd + 0.4, 24]],
    paths: [
      flat(stairs.x0 + 0.1, stairs.x1 - 0.1, stairEnd, l.ground.y1, 0.01, "#e2d8c3"),
      poly(
        [
          [0, Y, 0.02],
          [10, Y, 0.02],
          [10.6, D + 1.2, 0.02],
          [0.6, D + 1.2, 0.02],
        ],
        "rgba(30,40,30,0.1)",
      ),
    ],
  };
}

export const queenslander: Style = {
  draw,
  look: { walls: "boards_white", roof: "galvanised", fence: "none", garden: "leafy" },
};
