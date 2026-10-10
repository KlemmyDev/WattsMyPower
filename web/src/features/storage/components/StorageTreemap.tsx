import { useLayoutEffect, useRef, useState } from "react";
import { intAU, plural } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { cn } from "~/features/common/ui/utils";
import { bytes, share } from "~/features/storage/utils";

export type TreemapItem = {
  key: string;
  label: string;
  /** What it's in (the database), under its name in the tooltip. */
  where: string;
  bytes: number;
  rows: number | null;
  color: string;
  /** A quiet colour (a grey), which wants the page's own ink on it rather than the inverse. */
  quiet?: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };
type Placed = TreemapItem & Rect;

/** The worst aspect ratio of a row of `areas` laid along a side `side` long. */
function worst(areas: number[], side: number) {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk): items, largest first, laid in rows along the shorter side of what's
 * left, each row as long as keeps its boxes nearest square. Positions are in % of the box.
 */
function squarify(items: TreemapItem[], box: Rect, ratio: number): Placed[] {
  const total = items.reduce((s, i) => s + i.bytes, 0);
  if (!total) return [];
  // Work in a box whose width is `ratio` times its height, so "square" means square on screen.
  const scale = (box.w * ratio * box.h) / total;
  const out: Placed[] = [];
  let rest = [...items].sort((a, b) => b.bytes - a.bytes);
  let free = { x: box.x * ratio, y: box.y, w: box.w * ratio, h: box.h };
  while (rest.length) {
    const side = Math.min(free.w, free.h);
    const row: TreemapItem[] = [];
    let areas: number[] = [];
    while (rest.length) {
      const next = [...areas, rest[0].bytes * scale];
      if (areas.length && worst(next, side) > worst(areas, side)) break;
      row.push(rest[0]);
      areas = next;
      rest = rest.slice(1);
    }
    const sum = areas.reduce((a, b) => a + b, 0);
    const thick = sum / side;
    let at = 0;
    for (let i = 0; i < row.length; i++) {
      const len = areas[i] / thick;
      const r =
        free.w >= free.h
          ? { x: free.x, y: free.y + at, w: thick, h: len }
          : { x: free.x + at, y: free.y, w: len, h: thick };
      out.push({ ...row[i], x: r.x / ratio, y: r.y, w: r.w / ratio, h: r.h });
      at += len;
    }
    free =
      free.w >= free.h
        ? { x: free.x + thick, y: free.y, w: free.w - thick, h: free.h }
        : { x: free.x, y: free.y + thick, w: free.w, h: free.h - thick };
  }
  return out;
}

/**
 * What takes the room, as a treemap: each table a box as big as its share of the room, in its kind's colour (readings,
 * weather, prices…), named where it fits. Hovering (or tapping) one says what it is, its size and rows.
 */
export function StorageTreemap({ items, ratio = 1.6 }: { items: TreemapItem[]; ratio?: number }) {
  const total = items.reduce((s, i) => s + i.bytes, 0);
  const placed = squarify(
    items.filter((i) => i.bytes > 0),
    { x: 0, y: 0, w: 100, h: 100 },
    ratio,
  );
  const box = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const tip = placed.find((p) => p.key === hot);
  // Its width on screen, to know which boxes have room for their names.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = width / ratio;

  return (
    <div
      ref={box}
      className="relative w-full"
      style={{ aspectRatio: String(ratio) }}
      onMouseLeave={() => setHot(null)}
      role="img"
      aria-label="What takes the room in the databases"
    >
      {placed.map((p) => {
        // Big enough on screen for its name, and for its size under it.
        const pw = (p.w / 100) * width;
        const ph = (p.h / 100) * height;
        const named = pw > 84 && ph > 30;
        const sized = named && ph > 48;
        return (
          <button
            key={p.key}
            type="button"
            aria-label={`${p.label}: ${bytes(p.bytes)}`}
            onMouseEnter={() => setHot(p.key)}
            onFocus={() => setHot(p.key)}
            onClick={() => setHot(p.key)}
            className={cn(
              "absolute flex flex-col items-start justify-end overflow-hidden border-0 text-left transition-[opacity,filter] duration-200",
              named ? "p-2" : "p-0",
              pw < 28 || ph < 28 ? "rounded-[3px]" : "rounded-lg",
              p.quiet ? "text-ink" : "text-ink-inverse",
              hot && hot !== p.key && "opacity-45",
            )}
            style={{
              left: `calc(${p.x}% + 1.5px)`,
              top: `calc(${p.y}% + 1.5px)`,
              width: `calc(${p.w}% - 3px)`,
              height: `calc(${p.h}% - 3px)`,
              background: `linear-gradient(160deg, ${alpha(p.color, 0.95)}, ${alpha(p.color, 0.7)})`,
            }}
          >
            {named && <span className="w-full truncate text-[12px] leading-4 font-semibold">{p.label}</span>}
            {sized && <span className="text-[11px] leading-4 tabular-nums opacity-75">{bytes(p.bytes)}</span>}
          </button>
        );
      })}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-2 flex w-[220px] animate-pop flex-col gap-1 rounded-xl border border-line bg-popover px-3.5 py-3 text-[13px] shadow-pop"
          style={{
            left: `clamp(0px, calc(${tip.x + tip.w / 2}% - 110px), calc(100% - 220px))`,
            top: tip.y + tip.h / 2 > 50 ? undefined : `calc(${tip.y + tip.h}% + 6px)`,
            bottom: tip.y + tip.h / 2 > 50 ? `calc(${100 - tip.y}% + 6px)` : undefined,
          }}
        >
          <span className="flex items-center gap-2 font-semibold">
            <i className="size-2.5 flex-none rounded-xs" style={{ background: tip.color }} />
            <span className="truncate">{tip.label}</span>
          </span>
          <span className="text-xs text-ink-muted">{tip.where}</span>
          <span className="flex justify-between tabular-nums">
            <span>{bytes(tip.bytes)}</span>
            <span className="text-ink-muted">{share(tip.bytes, total)} of it all</span>
          </span>
          {tip.rows != null && (
            <span className="text-xs text-ink-muted tabular-nums">
              {intAU(tip.rows)} {plural(tip.rows, "row")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
