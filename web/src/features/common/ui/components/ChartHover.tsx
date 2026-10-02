import type { ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

/**
 * Hover affordances for the small SVG charts: a dashed vertical line and a tooltip box.
 * Position both with `left` as a percentage of the plot's width.
 */
export function HoverLine({ left, className }: { left: number; className?: string }) {
  return (
    <div
      className={cn("pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-line-strong", className)}
      style={{ left: `${left}%` }}
    />
  );
}

const TIP_W = 200;
const GAP = 12;

/**
 * The tooltip box, beside the hover line: to its right, or its left when `flip`. Given the plot's
 * `width` in pixels it picks the side with room itself, and on a plot too narrow for either side
 * (a phone) it centres on the line, kept inside the plot.
 */
function tipLeft(left: number, flip: boolean, width?: number): string {
  if (!width) return flip ? `calc(${left}% - ${TIP_W + GAP}px)` : `calc(${left}% + ${GAP}px)`;
  const x = (left / 100) * width;
  if (x + GAP + TIP_W <= width) return `${x + GAP}px`;
  if (x - GAP - TIP_W >= 0) return `${x - GAP - TIP_W}px`;
  return `${Math.max(0, Math.min(width - TIP_W, x - TIP_W / 2))}px`;
}

export function ChartTooltip({
  left,
  flip,
  width,
  children,
  className,
}: {
  left: number;
  flip: boolean;
  /** The plot's width in pixels, to keep the box inside it. */
  width?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-2 z-2 flex w-[200px] flex-col gap-1.5 rounded-xl border border-line bg-popover px-3.5 py-3 text-[13px] tabular-nums shadow-pop",
        className,
      )}
      style={{ left: tipLeft(left, flip, width) }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ label, value, color }: { label: ReactNode; value: ReactNode; color?: string }) {
  return (
    <div className="flex items-center justify-between text-ink-muted">
      <span className="flex items-center gap-1.5">
        {color && <i className="inline-block size-2 rounded-xs" style={{ background: color }} />}
        {label}
      </span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

/** Find the point nearest to `t` (points must be sorted or small). */
export function nearest<T extends { t: number }>(points: T[], t: number): T | null {
  let best: T | null = null;
  for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}
