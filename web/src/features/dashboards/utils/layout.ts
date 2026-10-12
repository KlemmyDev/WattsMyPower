import type { Screen, WidgetItem } from "~/features/dashboards/types";
import { GAP, ROW } from "~/features/common/widgets/room";

export { GAP, ROW };

/** How many columns each screen's grid has. */
export const COLS: Record<Screen, number> = { computer: 12, phone: 4 };

type Box = Pick<WidgetItem, "id" | "x" | "y" | "w" | "h">;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where the grid ends: the row under its lowest widget. */
export const bottom = (items: Box[]) => Math.max(0, ...items.map((i) => i.y + i.h));

/**
 * Each widget moved up as far as it'll go without passing another, top to bottom (a row's from the left), so the grid
 * has no gaps; `fixed` (one being moved or resized) keeps its place and the rest make room around it.
 */
export function compact<T extends Box>(items: T[], fixed?: string): T[] {
  const order = [...items].sort((a, b) => (a.id === fixed ? -1 : b.id === fixed ? 1 : a.y - b.y || a.x - b.x));
  const placed: T[] = [];
  for (const it of order) {
    if (it.id === fixed) {
      placed.push(it);
      continue;
    }
    let y = it.y;
    while (y > 0 && !placed.some((p) => overlaps({ ...it, y: y - 1 }, p))) y--;
    while (placed.some((p) => overlaps({ ...it, y }, p))) y++;
    placed.push({ ...it, y });
  }
  const at = new Map(placed.map((p) => [p.id, p]));
  return items.map((i) => at.get(i.id)!);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A widget moved to (x, y), kept inside the grid, the rest making room. */
export function move<T extends Box>(items: T[], id: string, x: number, y: number, cols: number): T[] {
  return compact(
    items.map((i) => (i.id === id ? { ...i, x: clamp(x, 0, cols - i.w), y: Math.max(0, y) } : i)),
    id,
  );
}

/** A widget resized to w × h (within its own limits and the grid), the rest making room. */
export function resize<T extends Box>(
  items: T[],
  id: string,
  w: number,
  h: number,
  cols: number,
  limits: { min: [number, number]; max: [number, number] },
): T[] {
  return compact(
    items.map((i) => {
      if (i.id !== id) return i;
      const nw = clamp(w, Math.min(limits.min[0], cols), Math.min(limits.max[0], cols));
      return { ...i, w: nw, h: clamp(h, limits.min[1], limits.max[1]), x: Math.min(i.x, cols - nw) };
    }),
    id,
  );
}

/** The first place, top to bottom and left to right, a w × h widget fits. */
export function firstFit(items: Box[], w: number, h: number, cols: number): { x: number; y: number } {
  for (let y = 0; ; y++)
    for (let x = 0; x + w <= cols; x++) if (!items.some((p) => overlaps({ id: "", x, y, w, h }, p))) return { x, y };
}

/**
 * A phone's layout from a computer's: the same widgets in the order they're read (top to bottom, left to right),
 * the narrow ones two to a row and the rest the whole width, as tall as each says it should be on a phone.
 */
export function forPhone(items: WidgetItem[], phoneSize: (item: WidgetItem) => [number, number]): WidgetItem[] {
  const placed: WidgetItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const [w, h] = phoneSize(item);
    if (x + w > COLS.phone) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    placed.push({ ...item, x, y, w, h });
    x += w;
    rowH = Math.max(rowH, h);
  }
  return compact(placed);
}

/** A short id for a new widget or dashboard. */
export const newId = () => Math.random().toString(36).slice(2, 10);
