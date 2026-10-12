import type { ReactNode } from "react";

/** A card's headline figure, in its top right corner: a small label over it, and a faint line under it. */
export function Corner({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-none flex-col items-end gap-0.5 text-right">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{value}</span>
      {sub && <span className="text-[11.5px] text-ink-faint tabular-nums">{sub}</span>}
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
    <div className="flex items-center justify-between gap-4 border-b border-line-subtle py-2.5 text-sm tabular-nums">
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
