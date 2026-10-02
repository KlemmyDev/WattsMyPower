import type { ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

/** A row of small figures in hairline-separated cells. */
export function StatGrid({
  stats,
  min = 160,
  className,
}: {
  stats: { label: string; value: ReactNode; color?: string }[];
  min?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-px overflow-hidden rounded-xl border border-line-subtle bg-line-subtle", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5 bg-surface px-4 py-3.5">
          <span className="text-xs text-ink-muted">{s.label}</span>
          <span className="text-lg font-semibold tabular-nums" style={{ color: s.color }}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A bar split into coloured shares of a whole. */
export function ShareBar({ parts }: { parts: { value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  return (
    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-track">
      {parts.map((p, i) => (
        <div key={i} style={{ width: `${((Math.max(0, p.value) / total) * 100).toFixed(1)}%`, background: p.color }} />
      ))}
    </div>
  );
}

/** A legend entry. */
export function Key({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

/** A label and value row with a coloured dot, and an optional share of the total. */
export function ShareRow({
  color,
  label,
  sub,
  share,
  value,
}: {
  color: string;
  label: ReactNode;
  sub?: ReactNode;
  share?: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-subtle py-3 text-sm tabular-nums">
      <span className="flex min-w-0 items-center gap-2.5">
        <i className="size-2 flex-none rounded-full" style={{ background: color }} />
        {sub ? (
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-ink">{label}</span>
            <span className="text-xs text-ink-faint">{sub}</span>
          </span>
        ) : (
          <span className="text-ink-muted">{label}</span>
        )}
      </span>
      <span className="flex flex-none items-baseline gap-3">
        {share && <span className="text-xs text-ink-faint">{share}</span>}
        <span className="font-medium text-ink">{value}</span>
      </span>
    </div>
  );
}
