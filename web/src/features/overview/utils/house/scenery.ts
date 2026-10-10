import type { ReactElement } from "react";
import { box, group, h, I, ln, poly, type Attrs, type Kid } from "~/features/overview/utils/house/iso";
import { houseKey, type HouseStyle, type Layout } from "~/features/overview/utils/house/layout";
import {
  defs,
  fence,
  flat,
  front,
  frontWall,
  gardenTree,
  lookOf,
  side,
  sideWall,
  type StyleLook,
  type StyleParts,
} from "~/features/overview/utils/house/parts";
import { brick } from "~/features/overview/utils/house/styles/brick";
import { bungalow } from "~/features/overview/utils/house/styles/bungalow";
import { coastal } from "~/features/overview/utils/house/styles/coastal";
import { estate } from "~/features/overview/utils/house/styles/estate";
import { farmhouse } from "~/features/overview/utils/house/styles/farmhouse";
import { federation } from "~/features/overview/utils/house/styles/federation";
import { modern } from "~/features/overview/utils/house/styles/modern";
import { queenslander } from "~/features/overview/utils/house/styles/queenslander";
import { townhouse } from "~/features/overview/utils/house/styles/townhouse";

/*
 * The parts of the drawing that don't move: ground, the house in its style, garage or carport, roof panels, garden,
 * pool and fence, and the overlays for wet ground and night. Built once for each house layout (Settings → Your house)
 * and reused for every render. The batteries, inverters and charger are drawn by HouseScene, as their lights
 * and gauges follow the readings.
 */

/** Each style: how it draws, and how it looks unless the household chooses otherwise. */
export const STYLES: Record<HouseStyle, { draw: (l: Layout) => StyleParts; look: StyleLook }> = {
  estate,
  brick,
  modern,
  coastal,
  queenslander,
  federation,
  bungalow,
  farmhouse,
  townhouse,
};

const LAWN = "#dbe6cf";
const PAVING = "#ebeae5";

function build(l: Layout) {
  const { garage: g, ground: gr, pool } = l;
  const style = STYLES[l.options.style];
  const parts = style.draw(l);
  const look = lookOf(l, style.look);

  const ground: Kid[] = [defs()];
  ground.push(...box(gr.x0, gr.x1, gr.y0, gr.y1, -0.5, 0, LAWN, "#bcc8ae", "#ccd7bf"));
  // Mown stripes across the lawn.
  for (let x = gr.x0 + 0.6; x < gr.x1; x += 1.6)
    ground.push(flat(x, Math.min(x + 0.8, gr.x1), gr.y0, gr.y1, 0.004, "#ffffff", { fillOpacity: 0.16 }));
  // Paving: a driveway beside the house, or in front of the garage, with its edge showing at the ground's sides.
  const [dx0, dx1, dy0] = g ? [g.x0 + 0.2, g.x1 - 0.2, g.y1] : [11, gr.x1, gr.y0];
  ground.push(flat(dx0, dx1, dy0, gr.y1, 0.01, PAVING));
  if (dx1 >= gr.x1) ground.push(side(gr.x1, dy0, gr.y1, -0.5, 0, "#cfcdc6"));
  ground.push(front(gr.y1, dx0, dx1, -0.5, 0, "#dcdad3"));
  if (!g)
    for (const yy of [1.0, 7.0])
      ground.push(ln([11.3, yy, 0.02], [gr.x1 - 0.3, yy, 0.02], { stroke: "rgba(0,0,0,0.06)", strokeWidth: 1.5 }));
  // Paving under the spots outside, beside a garage (without one, the driveway above is under them).
  if (g)
    for (const sp of l.spots.filter((p) => !p.garage)) {
      ground.push(flat(sp.x0 - 0.25, sp.x1 + 0.25, sp.y0 - 0.3, sp.y1 + 0.3, 0.012, PAVING));
      if (sp.x1 + 0.25 >= gr.x1) ground.push(side(gr.x1, sp.y0 - 0.3, sp.y1 + 0.3, -0.5, 0, "#cfcdc6"));
    }
  ground.push(...parts.paths);
  // The house's shadow on the ground beside its right side, and the garage's, away from the light.
  const shadowX = g && g.kind === "garage" ? g.x1 : 10;
  ground.push(
    poly(
      [
        [shadowX, -0.2, 0.015],
        [shadowX + 1.1, 0.4, 0.015],
        [shadowX + 1.1, 7.6, 0.015],
        [shadowX, 8, 0.015],
      ],
      "#1d2a1a",
      { fillOpacity: 0.07 },
    ),
    flat(shadowX, shadowX + 0.35, 0, 8, 0.016, "#1d2a1a", { fillOpacity: 0.06 }),
  );

  // The pool in the side garden: coping, water, the shade inside its walls, and a glass fence round it.
  const poolKids: Kid[] = [];
  const poolNight: Kid[] = [];
  if (pool) {
    const c = 0.4;
    poolKids.push(
      ...box(pool.x0 - c, pool.x1 + c, pool.y0 - c, pool.y1 + c, 0, 0.08, "#efece4", "#d9d5ca", "#e2ded4"),
      flat(pool.x0, pool.x1, pool.y0, pool.y1, 0.085, "url(#pool)"),
      flat(pool.x0, pool.x1, pool.y0, pool.y0 + 0.4, 0.087, "#0f4a66", { fillOpacity: 0.22 }),
      flat(pool.x0, pool.x0 + 0.4, pool.y0 + 0.4, pool.y1, 0.087, "#0f4a66", { fillOpacity: 0.16 }),
    );
    for (const [x, y, w] of [
      [pool.x0 + 1.0, pool.y0 + 2.0, 1.2],
      [pool.x0 + 2.2, pool.y0 + 3.6, 0.9],
      [pool.x0 + 0.8, pool.y0 + 4.4, 0.7],
    ])
      poolKids.push(
        ln([x, y, 0.09], [x + w, y - w * 0.4, 0.09], { stroke: "#ffffff", strokeOpacity: 0.45, strokeWidth: 1.2 }),
      );
    poolNight.push(flat(pool.x0, pool.x1, pool.y0, pool.y1, 0.09, "#5fd0ef", { fillOpacity: 0.5 }));
  }
  const glassFence: Kid[] = [];
  if (pool) {
    const [fx0, fx1, fy0, fy1] = [pool.x0 - 0.9, pool.x1 + 0.9, pool.y0 - 0.9, pool.y1 + 0.9];
    const glass: Attrs = { fillOpacity: 0.28, stroke: "#9fb4c4", strokeWidth: 0.8, strokeOpacity: 0.8 };
    glassFence.push(
      front(fy1, fx0, fx1, 0.1, 1.25, "#e3eef6", glass),
      side(fx1, fy0, fy1, 0.1, 1.25, "#d6e4ee", glass),
    );
    for (let x = fx0; x <= fx1 + 0.01; x += (fx1 - fx0) / 4)
      glassFence.push(ln([x, fy1, 0], [x, fy1, 0.12], { stroke: "#8a96a0", strokeWidth: 2 }));
  }

  // The tree behind the house and the power pole, then the house.
  const house: Kid[] = [...poolKids];
  if (!l.shape.attached) house.push(gardenTree(look.garden === "minimal" ? "leafy" : look.garden, -1.2, 2.2, 26));
  {
    const b = I(-2.2, 7, 0);
    house.push(h("ellipse", { cx: b[0] + 4, cy: b[1] + 1, rx: 8, ry: 3, fill: "rgba(0,0,0,0.12)" }));
  }
  house.push(
    ln([-1.5, 9.7, 0], [-1.5, 9.7, 8.2], { stroke: "#7b6652", strokeWidth: 4.5 }),
    ln([-1.5, 8.8, 7.6], [-1.5, 10.6, 7.6], { stroke: "#7b6652", strokeWidth: 3 }),
    ...parts.house,
  );

  // The garage: its floor and back wall (seen when it's see-through), then its walls, roof and door; or the
  // carport: its posts and beams, under a roof of clear sheeting.
  const garageInside: Kid[] = [];
  const garageShell: Kid[] = [];
  if (g && g.kind === "carport") {
    const { roof } = look;
    const post = (x: number, y: number) =>
      box(x - 0.1, x + 0.1, y - 0.1, y + 0.1, 0, g.top, roof.face, roof.side, roof.back);
    garageInside.push(flat(g.x0, g.x1, g.y0, g.y1, 0.012, "#e4e2dc"), ...post(g.x1 - 0.15, g.y0 + 0.15));
    garageShell.push(...post(g.x1 - 0.15, g.y1 - 0.1));
    if (g.spaces === 2) garageShell.push(...post((g.x0 + g.x1) / 2, g.y1 - 0.1));
    const [x0, x1, y0, y1, z] = [g.x0, g.x1 + 0.1, g.y0 - 0.1, g.y1 + 0.15, g.top];
    garageShell.push(
      flat(x0, x1, y0, y1, z + 0.18, "#eaf3fa", { fillOpacity: 0.42 }),
      ...Array.from({ length: Math.floor((x1 - x0) / 0.3) }, (_, i) =>
        ln([x0 + (i + 1) * 0.3, y0, z + 0.19], [x0 + (i + 1) * 0.3, y1, z + 0.19], {
          stroke: "#ffffff",
          strokeOpacity: 0.5,
          strokeWidth: 0.8,
        }),
      ),
      front(y1, x0, x1, z, z + 0.18, roof.back),
      side(x1, y0, y1, z, z + 0.18, roof.side),
      ln([x0, (y0 + y1) / 2, z + 0.19], [x1, (y0 + y1) / 2, z + 0.19], { stroke: roof.side, strokeWidth: 1.6 }),
    );
  } else if (g) {
    const { walls, roof } = look;
    const ghost: Attrs = l.ghostGarage ? { fillOpacity: 0.38, stroke: "#8193ad", strokeWidth: 1.1 } : {};
    if (l.ghostGarage)
      garageInside.push(
        flat(g.x0, g.x1, g.y0, g.y1, 0.02, "#d9d6cf"),
        front(g.y0 + 0.02, g.x0, g.x1, 0, g.top, "#e6e1d7"),
      );
    if (l.ghostGarage)
      garageShell.push(
        side(g.x1, g.y0, g.y1, 0, g.top, walls.side, ghost),
        front(g.y1, g.x0, g.x1, 0, g.top, walls.face, ghost),
      );
    else
      garageShell.push(...sideWall(walls, g.x1, g.y0, g.y1, 0, g.top), ...frontWall(walls, g.y1, g.x0, g.x1, 0, g.top));
    garageShell.push(
      side(g.x1 + 0.01, g.y0, g.y1, 0, 0.35, walls.plinth, l.ghostGarage ? { fillOpacity: 0.5 } : {}),
      front(g.y1 + 0.01, g.x0, g.x1, 0, 0.35, walls.plinth, l.ghostGarage ? { fillOpacity: 0.5 } : {}),
    );
    // One roller door, wide enough for two cars in a double garage, in the shade of the roof's overhang.
    const [d0, d1] = [g.x0 + 0.5, g.x1 - 0.5];
    garageShell.push(
      front(g.y1 + 0.015, d0 - 0.12, d1 + 0.12, 0, 2.62, walls.plinth, l.ghostGarage ? { fillOpacity: 0.3 } : {}),
      front(g.y1 + 0.02, d0, d1, 0, 2.5, "#e7e3dc", {
        stroke: "#bdb6a9",
        strokeWidth: 0.8,
        ...(l.ghostGarage ? { fillOpacity: 0.3 } : {}),
      }),
    );
    for (let z = 0.3; z < 2.5; z += 0.3)
      garageShell.push(ln([d0, g.y1 + 0.03, z], [d1, g.y1 + 0.03, z], { stroke: "rgba(0,0,0,0.07)", strokeWidth: 1 }));
    if (!l.ghostGarage) garageShell.push(front(g.y1 + 0.03, d0, d1, 2.2, 2.5, "#1b1f2a", { fillOpacity: 0.08 }));
    // A flat roof just over the walls, with a little overhang at the front: like glass when it's see-through.
    const roofBox = l.ghostGarage
      ? box(g.x0, g.x1 + 0.15, g.y0 - 0.1, g.y1 + 0.25, g.top, g.top + 0.22, "#dfe7f2", "#c9d3e2", "#d3dcea")
      : box(g.x0, g.x1 + 0.15, g.y0 - 0.1, g.y1 + 0.25, g.top, g.top + 0.22, roof.face, roof.side, roof.back);
    garageShell.push(
      l.ghostGarage
        ? h("g", { opacity: 0.4, stroke: "#8193ad", strokeWidth: 1, strokeLinejoin: "round" }, ...roofBox)
        : group(roofBox),
    );
  }

  // Along the street: the fence, from the garden's left edge (or the townhouse's own) to the driveway, open at the
  // front path.
  const fenceX0 = l.shape.attached ? 0.2 : gr.x0 + 0.3;
  const fenceKids = look.fence === "none" ? [] : fence(look.fence, gr.y1 - 0.35, fenceX0, dx0 - 0.35, l.shape.gate);
  const trees = parts.trees.map(([x, y, r]) => gardenTree(look.garden, x, y, r));

  // wet ground for rain/storm
  const wet: Kid[] = [flat(gr.x0, gr.x1, gr.y0, gr.y1, 0.03, "rgba(70,90,120,0.1)")];
  const puddles: [number, number, number][] = g
    ? [
        [(g.x0 + g.x1) / 2, gr.y1 - 1, 26],
        [gr.x1 - 1, 0.2, 22],
      ]
    : [
        [12.4, 8.6, 30],
        [14.2, 0.2, 22],
        [13.1, 9.8, 18],
      ];
  for (const [px0, py0, rx] of puddles) {
    const c = I(px0, py0, 0.03);
    wet.push(h("ellipse", { cx: c[0], cy: c[1], rx, ry: rx * 0.36, fill: "rgba(140,160,190,0.45)" }));
  }

  return {
    ground: group(ground),
    house: group(house),
    garageInside: group(garageInside),
    garageShell: group(garageShell),
    roof: group(parts.roof),
    yard: group(parts.yard, glassFence, trees, fenceKids),
    wet: group(wet),
    night: group(poolNight, parts.night),
  } satisfies Record<string, ReactElement>;
}

const cache = new Map<string, ReturnType<typeof build>>();
/** The static scenery for a house layout, built on first use. */
export function scenery(l: Layout) {
  const key = houseKey(l.options);
  let s = cache.get(key);
  if (!s) cache.set(key, (s = build(l)));
  return s;
}
