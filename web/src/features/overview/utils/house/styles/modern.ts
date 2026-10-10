import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { modernBoxes, type Layout } from "~/features/overview/utils/house/layout";
import { shade } from "~/features/overview/utils/house/palette";
import {
  flat,
  front,
  frontWall,
  LIT,
  litFront,
  lookOf,
  meterBox,
  panelRows,
  shrub,
  side,
  sideWall,
  WARM,
  type Style,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The modern home: crisp white boxes under a thin flat roof, glass from floor to ceiling across the front, a
 * dark pivot door, the upper floor (when there is one) reaching out over the front, solar on tilted frames
 * up on the roof, and a lap pool out the front.
 */

const DARK = "#2b2f35";

/** A run of glass across a wall facing the street, split by thin dark mullions. */
function glassFront(y: number, x0: number, x1: number, z0: number, z1: number, panes: number): Kid[] {
  const out: Kid[] = [front(y + 0.01, x0 - 0.08, x1 + 0.08, z0 - 0.08, z1 + 0.08, DARK)];
  out.push(front(y + 0.02, x0, x1, z0, z1, "url(#glassDark)"));
  for (let i = 1; i < panes; i++) {
    const x = x0 + ((x1 - x0) * i) / panes;
    out.push(ln([x, y + 0.03, z0], [x, y + 0.03, z1], { stroke: DARK, strokeWidth: 2 }));
  }
  // a soft reflection across the glass
  out.push(
    poly(
      [
        [x0 + 0.4, y + 0.03, z1],
        [x0 + 1.6, y + 0.03, z1],
        [x0 + 0.4 + (z1 - z0) * 0.6 + 1.2, y + 0.03, z0],
        [x0 + 0.4 + (z1 - z0) * 0.6, y + 0.03, z0],
      ],
      "#ffffff",
      { fillOpacity: 0.08 },
    ),
  );
  return out;
}

/** Up to `n` tilted panels on frames standing on a flat roof at height z, in rows across [y0, y1], the front row
 * filled first (and drawn last, over the rows behind). */
function roofArray(z: number, x0: number, x1: number, y0: number, y1: number, n: number): Kid[] {
  const depth = 1.5;
  const rows = Math.floor((y1 - y0 + 0.5) / (depth + 0.5));
  const drawn: Kid[][] = [];
  let left = n;
  for (let r = 0; r < rows && left > 0; r++) {
    const yb = y1 - depth - r * (depth + 0.5); // the row's back edge
    const at = (u: number, v: number): P3 => [u, yb + v, z + 0.75 - (0.57 * v) / depth];
    const row = panelRows(at, [{ u0: x0, u1: x1, v0: 0, v1: depth }], left);
    drawn.push([
      ln([x1 - 0.3, yb + 0.05, z], [x1 - 0.3, yb + 0.05, z + 0.72], { stroke: "#9aa1ab", strokeWidth: 1.5 }),
      ...row.kids,
    ]);
    left -= row.placed;
  }
  return drawn.reverse().flat();
}

function draw(l: Layout): StyleParts {
  const { lower, upper, roofZ } = modernBoxes(l.options.storeys);
  const { walls, roof: RF } = lookOf(l, modern.look);
  const WHITE = walls.face;
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const lz = lower.z1;

  // Ground floor: the white box, a dark pivot door at the left, then glass to the right.
  house.push(
    ...sideWall(walls, 10, lower.y0, lower.y1, 0, lz),
    ...frontWall(walls, 8, 0, 10, 0, lz),
    front(8.01, 0, 10, 0, 0.15, DARK),
    side(10.01, lower.y0, lower.y1, 0, 0.15, DARK),
    front(8.02, 0.9, 1.9, 0, 3.0, "#3a3f46"),
    ln([1.75, 8.03, 0.9], [1.75, 8.03, 2.3], { stroke: "#c9a96b", strokeWidth: 2.2 }),
    meterBox(8, 0.22, 2.4),
    ...glassFront(8, 2.6, 9.6, 0.3, lz - 0.35, 4),
  );
  for (const w of l.sideWindows.filter((w) => w.z1 <= lz))
    house.push(
      side(10.01, w.y0 - 0.08, w.y1 + 0.08, w.z0 - 0.08, w.z1 + 0.08, DARK),
      side(10.02, w.y0, w.y1, w.z0, w.z1, "url(#glassDark)"),
    );

  if (upper) {
    // A dark floor plate, then the upper box reaching out over the front: glass across it, a band of it down
    // the side.
    house.push(
      side(10, 0, upper.y1, lz, upper.z0, DARK),
      front(upper.y1, 0, 10, lz, upper.z0, DARK),
      ...sideWall(walls, 10, upper.y0, upper.y1, upper.z0, upper.z1),
      ...frontWall(walls, upper.y1, 0, 10, upper.z0, upper.z1),
      ...glassFront(upper.y1, 0.5, 9.5, upper.z0 + 0.3, upper.z1 - 0.35, 5),
    );
    for (const w of l.sideWindows.filter((w) => w.z0 >= upper.z0))
      house.push(
        side(10.01, w.y0 - 0.08, w.y1 + 0.08, w.z0 - 0.08, w.z1 + 0.08, DARK),
        side(10.02, w.y0, w.y1, w.z0, w.z1, "url(#glassDark)"),
      );
  }

  // The flat roof: a thin white slab with a little overhang, and the panels on their frames.
  const top = upper ?? lower;
  roof.push(
    ...box(
      top.x0 - 0.35,
      top.x1 + 0.35,
      top.y0 - 0.35,
      top.y1 + 0.35,
      roofZ,
      roofZ + 0.35,
      RF.face,
      shade(WHITE, 0.2),
      shade(WHITE, 0.1),
    ),
  );
  roof.push(
    ln([top.x0 - 0.35, top.y1 + 0.35, roofZ], [top.x1 + 0.35, top.y1 + 0.35, roofZ], {
      stroke: "#d4d6d9",
      strokeWidth: 1.2,
    }),
  );
  roof.push(...roofArray(roofZ + 0.35, top.x0 + 0.4, top.x1 - 0.4, top.y0 + 0.3, top.y1 - 0.3, l.options.panels));
  // Downlights under the roof's front edge.
  const lights: P3[] = [2.0, 4.6, 7.2, 9.6].map((x) => [x, top.y1 + 0.2, roofZ - 0.02]);
  for (const p of lights) {
    const c = I(...p);
    roof.push(h("circle", { cx: c[0], cy: c[1], r: 1.3, fill: "#d8d8d8" }));
  }

  // At night the glass glows.
  night.push(...litFront(8, 2.6, 9.6, 0.3, lz - 0.35, true));
  for (let i = 1; i < 4; i++) {
    const x = 2.6 + (7 * i) / 4;
    night.push(ln([x, 8.03, 0.3], [x, 8.03, lz - 0.35], { stroke: "#c9a35c", strokeWidth: 2 }));
  }
  if (upper) {
    night.push(front(upper.y1 + 0.03, 0.5, 9.5, upper.z0 + 0.3, upper.z1 - 0.35, WARM));
    for (let i = 1; i < 5; i++) {
      const x = 0.5 + (9 * i) / 5;
      night.push(
        ln([x, upper.y1 + 0.04, upper.z0 + 0.3], [x, upper.y1 + 0.04, upper.z1 - 0.35], {
          stroke: "#c9a35c",
          strokeWidth: 2,
        }),
      );
    }
  }
  for (const w of l.sideWindows) night.push(side(10.04, w.y0, w.y1, w.z0, w.z1, LIT));
  for (const p of lights) {
    const c = I(...p);
    night.push(
      h("ellipse", { cx: c[0], cy: c[1] + 14, rx: 12, ry: 22, fill: WARM, fillOpacity: 0.16 }),
      h("circle", { cx: c[0], cy: c[1], r: 2, fill: "#fff3cf" }),
    );
  }
  // and so does the lap pool (a bed of grasses instead, when there's a pool in the side garden)
  if (!l.pool) night.push(flat(3.25, 8.55, 9.45, 10.15, 0.04, "#5fd0ef", { fillOpacity: 0.55 }));

  return {
    house,
    roof,
    night,
    yard: [
      // A lap pool along the front (or grasses), and a clipped hedge at the corner.
      flat(3.0, 8.8, 9.3, 10.3, 0.02, "#f2f2f0", { stroke: "#dcdcd8", strokeWidth: 1 }),
      l.pool ? flat(3.25, 8.55, 9.45, 10.15, 0.03, "#b9c9a6") : flat(3.25, 8.55, 9.45, 10.15, 0.03, "url(#pool)"),
      ...(l.pool ? [3.7, 4.6, 5.5, 6.4, 7.3, 8.2].map((x) => shrub(x, 9.8, 4, "#8eaa78")) : []),
      ...[9.3, 9.75].map((x) => shrub(x, 8.5, 6, "#7fa06e")),
    ],
    trees: [[-0.6, 8.9, 14]],
    paths: [
      flat(0.9, 1.9, 8, l.ground.y1, 0.01, "#e4e4e1"),
      poly(
        [
          [0, 8, 0.02],
          [10, 8, 0.02],
          [10.6, 10.4, 0.02],
          [0.6, 10.4, 0.02],
        ],
        "rgba(30,40,30,0.07)",
      ),
    ],
  };
}

export const modern: Style = {
  draw,
  look: { walls: "render_white", roof: "surfmist", fence: "none", garden: "tropical" },
};
