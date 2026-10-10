import { I, type P3 } from "~/features/overview/utils/house/iso";
import { layoutFor, type HouseOptions, type Layout } from "~/features/overview/utils/house/layout";

/** A part of the house its own choices change, on a phone (Settings → Your house). */
export type HousePart = "kind" | "roof" | "walls" | "cars" | "garden" | "units";

/** Where a part's dot sits over the drawing: as a share of the frame's width and height (0..1). */
export type PartSpot = { part: Exclude<HousePart, "kind">; x: number; y: number };

/** The drawing's frame (HouseScene's viewBox), which the picture fills by cropping ("slice"). */
const VB = { x: -200, y: 0, w: 1200, h: 600 };

/**
 * Where on a frame `aspect` wide (to its height) each part's dot goes: on the roof, the front wall, the garage or
 * carport (or the empty spot a car would park in without one), the pool or the front garden, and the main inverter.
 */
export function partSpots(house: HouseOptions, aspect: number): PartSpot[] {
  const l: Layout = layoutFor(house);
  const { scale, dx, dy } = l.fit;
  // The part of the frame that shows: all of its height and the middle of its width, or the other way round.
  const w = aspect < VB.w / VB.h ? VB.h * aspect : VB.w;
  const h = aspect < VB.w / VB.h ? VB.h : VB.w / aspect;
  const x0 = VB.x + (VB.w - w) / 2;
  const y0 = VB.y + (VB.h - h) / 2;
  const at = (p: P3) => {
    const [px, py] = I(...p);
    return { x: (px * scale + dx - x0) / w, y: (py * scale + dy - y0) / h };
  };

  const side = l.shape.side;
  const g = l.garage;
  const sp = l.spots[0];
  const inv = l.inverters[0];
  const spots: PartSpot[] = [
    { part: "roof", ...at([5, 4, l.shape.top - 0.9]) },
    { part: "walls", ...at([2.4, 8, side.zMin + (side.zMax - side.zMin) * 0.5]) },
  ];
  if (g) spots.push({ part: "cars", ...at([(g.x0 + g.x1) / 2, g.y1, g.top * 0.55]) });
  else if (sp) spots.push({ part: "cars", ...at([(sp.x0 + sp.x1) / 2, (sp.y0 + sp.y1) / 2, 0]) });
  spots.push({
    part: "garden",
    ...(l.pool
      ? at([(l.pool.x0 + l.pool.x1) / 2, (l.pool.y0 + l.pool.y1) / 2, 0])
      : at([l.ground.x0 + 1.4, l.ground.y1 - 1.6, 0])),
  });
  if (inv) spots.push({ part: "units", ...at([inv.x + 0.2, (inv.y0 + inv.y1) / 2, (inv.z0 + inv.z1) / 2]) });
  // Kept inside the frame, clear of its edges.
  return spots.map((s) => ({ ...s, x: Math.min(Math.max(s.x, 0.06), 0.94), y: Math.min(Math.max(s.y, 0.08), 0.92) }));
}
