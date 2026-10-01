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

export function ChartTooltip({
  left,
  flip,
  children,
  className,
}: {
  left: number;
  flip: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-2 z-2 flex w-[200px] flex-col gap-1.5 rounded-xl border border-line bg-popover px-3.5 py-3 text-[13px] tabular-nums shadow-pop",
        className,
      )}
      style={{ left: flip ? `calc(${left}% - 212px)` : `calc(${left}% + 12px)` }}
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
