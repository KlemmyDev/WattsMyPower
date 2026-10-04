import type { ReactElement } from "react";
import { box, group, h, I, ln, type Attrs, type Kid } from "~/features/overview/utils/house/iso";
import { houseKey, type HouseStyle, type Layout } from "~/features/overview/utils/house/layout";
import { defs, flat, front, side, tree, type StyleParts } from "~/features/overview/utils/house/parts";
import { estate } from "~/features/overview/utils/house/styles/estate";
import { farmhouse } from "~/features/overview/utils/house/styles/farmhouse";
import { federation } from "~/features/overview/utils/house/styles/federation";
import { modern } from "~/features/overview/utils/house/styles/modern";
import { queenslander } from "~/features/overview/utils/house/styles/queenslander";

/*
 * The parts of the drawing that don't move: ground, the house in its style, garage, roof panels, garden, and
 * the overlays for wet ground and night. Built once for each house layout (Settings → System → Your house)
 * and reused for every render. The batteries, inverters and charger are drawn by HouseScene, as their lights
 * and gauges follow the readings.
 */

const STYLES: Record<HouseStyle, (l: Layout) => StyleParts> = { estate, modern, queenslander, federation, farmhouse };

function build(l: Layout) {
  const { garage: g, ground: gr } = l;
  const style = STYLES[l.options.style](l);

  const ground: Kid[] = [defs()];
  ground.push(...box(gr.x0, gr.x1, gr.y0, gr.y1, -0.5, 0, "#e3e9da", "#c3ccb7", "#d2dac6"));
  // Paving: a driveway beside the house, or in front of the garage, with its edge showing at the ground's sides.
  const [dx0, dx1, dy0] = g ? [g.x0 + 0.2, g.x1 - 0.2, g.y1] : [11, gr.x1, gr.y0];
  ground.push(flat(dx0, dx1, dy0, gr.y1, 0.01, "#ebeae5"));
  if (dx1 >= gr.x1) ground.push(side(gr.x1, dy0, gr.y1, -0.5, 0, "#cfcdc6"));
  ground.push(front(gr.y1, dx0, dx1, -0.5, 0, "#dcdad3"));
  if (!g)
    for (const yy of [1.0, 7.0])
      ground.push(ln([11.3, yy, 0.02], [gr.x1 - 0.3, yy, 0.02], { stroke: "rgba(0,0,0,0.06)", strokeWidth: 1.5 }));
  // Paving under the spots outside, beside a garage (without one, the driveway above is under them).
  if (g)
    for (const sp of l.spots.filter((p) => !p.garage)) {
      ground.push(flat(sp.x0 - 0.25, sp.x1 + 0.25, sp.y0 - 0.3, sp.y1 + 0.3, 0.012, "#ebeae5"));
      if (sp.x1 + 0.25 >= gr.x1) ground.push(side(gr.x1, sp.y0 - 0.3, sp.y1 + 0.3, -0.5, 0, "#cfcdc6"));
    }
  ground.push(...style.paths);

  // The back tree and the power pole, then the house.
  const house: Kid[] = [tree(-1.2, 2.2, 26)];
  {
    const b = I(-2.2, 7, 0);
    house.push(h("ellipse", { cx: b[0] + 4, cy: b[1] + 1, rx: 8, ry: 3, fill: "rgba(0,0,0,0.12)" }));
  }
  house.push(
    ln([-1.5, 9.7, 0], [-1.5, 9.7, 8.2], { stroke: "#7b6652", strokeWidth: 4.5 }),
    ln([-1.5, 8.8, 7.6], [-1.5, 10.6, 7.6], { stroke: "#7b6652", strokeWidth: 3 }),
    ...style.house,
  );

  // The garage: its floor and back wall (seen when it's see-through), then its walls, roof and door.
  const garageInside: Kid[] = [];
  const garageShell: Kid[] = [];
  if (g) {
    const ghost: Attrs = l.ghostGarage ? { fillOpacity: 0.38, stroke: "#8193ad", strokeWidth: 1.1 } : {};
    if (l.ghostGarage)
      garageInside.push(
        flat(g.x0, g.x1, g.y0, g.y1, 0.02, "#d9d6cf"),
        front(g.y0 + 0.02, g.x0, g.x1, 0, g.top, "#e6e1d7"),
      );
    garageShell.push(
      side(g.x1, g.y0, g.y1, 0, g.top, "#ddd6ca", ghost),
      front(g.y1, g.x0, g.x1, 0, g.top, "#f6f2eb", ghost),
      side(g.x1 + 0.01, g.y0, g.y1, 0, 0.35, "#c2bbad", l.ghostGarage ? { fillOpacity: 0.5 } : {}),
      front(g.y1 + 0.01, g.x0, g.x1, 0, 0.35, "#d8d2c6", l.ghostGarage ? { fillOpacity: 0.5 } : {}),
    );
    // One roller door, wide enough for two cars in a double garage.
    const [d0, d1] = [g.x0 + 0.5, g.x1 - 0.5];
    garageShell.push(
      front(g.y1 + 0.02, d0, d1, 0, 2.5, "#e7e3dc", {
        stroke: "#bdb6a9",
        strokeWidth: 0.8,
        ...(l.ghostGarage ? { fillOpacity: 0.3 } : {}),
      }),
    );
    for (let z = 0.3; z < 2.5; z += 0.3)
      garageShell.push(ln([d0, g.y1 + 0.03, z], [d1, g.y1 + 0.03, z], { stroke: "rgba(0,0,0,0.07)", strokeWidth: 1 }));
    // A flat roof just over the walls, with a little overhang at the front: like glass when it's see-through.
    const roofBox = l.ghostGarage
      ? box(g.x0, g.x1 + 0.15, g.y0 - 0.1, g.y1 + 0.25, g.top, g.top + 0.22, "#dfe7f2", "#c9d3e2", "#d3dcea")
      : box(g.x0, g.x1 + 0.15, g.y0 - 0.1, g.y1 + 0.25, g.top, g.top + 0.22, "#4a5059", "#3c4149", "#43484f");
    garageShell.push(
      l.ghostGarage
        ? h("g", { opacity: 0.4, stroke: "#8193ad", strokeWidth: 1, strokeLinejoin: "round" }, ...roofBox)
        : group(roofBox),
    );
  }

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
    roof: group(style.roof),
    yard: group(style.yard),
    wet: group(wet),
    night: group(style.night),
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
