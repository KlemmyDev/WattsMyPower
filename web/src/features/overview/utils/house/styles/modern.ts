import { box, h, I, ln, poly, type Kid, type P3 } from "~/features/overview/utils/house/iso";
import { modernBoxes, type Layout } from "~/features/overview/utils/house/layout";
import {
  flat,
  front,
  litFront,
  palm,
  panel,
  shrub,
  side,
  WARM,
  type StyleParts,
} from "~/features/overview/utils/house/parts";

/*
 * The modern home: crisp white boxes under a thin flat roof, glass from floor to ceiling across the front, a
 * dark pivot door, the upper floor (when there is one) reaching out over the front, solar on tilted frames
 * up on the roof, and a lap pool out the front.
 */

const WHITE = "#f7f7f5";
const SHADE = "#e4e5e3";
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

/** Tilted panels on frames standing on a flat roof at height z, in rows across [y0, y1]. */
function roofArray(z: number, x0: number, x1: number, y0: number, y1: number): Kid[] {
  const out: Kid[] = [];
  const rows = 2;
  const cols = 4;
  const depth = 1.5;
  const w = (x1 - x0 - 0.3 * (cols - 1)) / cols;
  for (let r = 0; r < rows; r++) {
    const yb = y0 + ((y1 - y0 - depth) * r) / Math.max(rows - 1, 1); // the row's back edge
    for (let c = 0; c < cols; c++) {
      const xa = x0 + c * (w + 0.3);
      const xb = xa + w;
      const back: [P3, P3] = [
        [xa, yb, z + 0.75],
        [xb, yb, z + 0.75],
      ];
      const fr: [P3, P3] = [
        [xb, yb + depth, z + 0.18],
        [xa, yb + depth, z + 0.18],
      ];
      out.push(ln([xb - 0.1, yb + 0.05, z], [xb - 0.1, yb + 0.05, z + 0.72], { stroke: "#9aa1ab", strokeWidth: 1.5 }));
      out.push(...panel(fr[1], fr[0], back[1], back[0]));
    }
  }
  return out;
}

export function modern(l: Layout): StyleParts {
  const { lower, upper, roofZ } = modernBoxes(l.options.storeys);
  const house: Kid[] = [];
  const roof: Kid[] = [];
  const night: Kid[] = [];
  const lz = lower.z1;

  // Ground floor: the white box, a dark pivot door at the left, then glass to the right.
  house.push(
    side(10, lower.y0, lower.y1, 0, lz, SHADE),
    front(8, 0, 10, 0, lz, WHITE),
    front(8.01, 0, 10, 0, 0.15, DARK),
    side(10.01, lower.y0, lower.y1, 0, 0.15, DARK),
    front(8.02, 0.9, 1.9, 0, 3.0, "#3a3f46"),
    ln([1.75, 8.03, 0.9], [1.75, 8.03, 2.3], { stroke: "#c9a96b", strokeWidth: 2.2 }),
    front(8.02, 0.25, 0.7, 2.4, 3.2, "#e6e6e6", { stroke: "#b5b5b5", strokeWidth: 0.8 }),
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
      side(10, upper.y0, upper.y1, upper.z0, upper.z1, SHADE),
      front(upper.y1, 0, 10, upper.z0, upper.z1, WHITE),
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
      "#e9eaec",
      "#ffffff",
      "#f2f2f0",
    ),
  );
  roof.push(
    ln([top.x0 - 0.35, top.y1 + 0.35, roofZ], [top.x1 + 0.35, top.y1 + 0.35, roofZ], {
      stroke: "#d4d6d9",
      strokeWidth: 1.2,
    }),
  );
  roof.push(...roofArray(roofZ + 0.35, top.x0 + 0.6, top.x1 - 0.6, top.y0 + 0.5, top.y1 - 0.4));
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
  for (const w of l.sideWindows) night.push(side(10.03, w.y0, w.y1, w.z0, w.z1, "#f5c46e"));
  for (const p of lights) {
    const c = I(...p);
    night.push(
      h("ellipse", { cx: c[0], cy: c[1] + 14, rx: 12, ry: 22, fill: WARM, fillOpacity: 0.16 }),
      h("circle", { cx: c[0], cy: c[1], r: 2, fill: "#fff3cf" }),
    );
  }
  // and so does the pool
  night.push(flat(3.25, 8.55, 9.45, 10.15, 0.04, "#5fd0ef", { fillOpacity: 0.55 }));

  return {
    house,
    roof,
    night,
    yard: [
      // A lap pool along the front, a clipped hedge at the corner, and a palm.
      flat(3.0, 8.8, 9.3, 10.3, 0.02, "#f2f2f0", { stroke: "#dcdcd8", strokeWidth: 1 }),
      flat(3.25, 8.55, 9.45, 10.15, 0.03, "url(#pool)"),
      ...[9.3, 9.75].map((x) => shrub(x, 8.5, 6, "#7fa06e")),
      palm(-0.6, 8.9, 4.4),
    ],
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
