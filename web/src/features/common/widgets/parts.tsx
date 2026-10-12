import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { historyQuery } from "~/features/common/readings/api";
import { Card } from "~/features/common/ui/components/Card";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/** A widget's own card: compact, the whole of its cell, with what it is in a small line at the top. */
export function WidgetCard({
  title,
  icon,
  aside,
  className,
  children,
}: {
  title?: ReactNode;
  icon?: IconName;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("h-full gap-3 overflow-hidden p-5 max-sm:p-4", className)}>
      {(title || aside) && (
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-ink-muted">
          {icon && <Icon name={icon} size={15} className="flex-none" />}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {aside}
        </div>
      )}
      {children}
    </Card>
  );
}

/** A figure, big, with its unit small after it. */
export function Big({
  value,
  unit,
  className,
  color,
}: {
  value: ReactNode;
  unit?: string;
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={cn(
        "text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums max-sm:text-[32px] max-sm:leading-9",
        className,
      )}
      style={color ? { color } : undefined}
    >
      {value}
      {unit && <span className="ml-1 text-[15px] tracking-normal text-ink-muted">{unit}</span>}
    </span>
  );
}

/** A figure's value and unit apart: "8.6 kW" → ["8.6", "kW"]. */
export const parts = (text: string): [string, string] => {
  const i = text.lastIndexOf(" ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
};

/** Said where a widget has nothing to show yet, quietly, in the middle of it. */
export function Quiet({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center text-[13px] text-pretty text-ink-faint">{children}</div>;
}

const SPAN = 2 * 3600;

/** A reading's last two hours, as a thin line. */
export function Spark({
  field,
  color,
  now,
  className,
  range,
}: {
  field: string;
  color: string;
  now: number;
  className?: string;
  /** The line's bottom and top; else its own lowest and highest. */
  range?: [number, number];
}) {
  const end = now - (now % 300);
  const { data } = useQuery(historyQuery({ start: end - SPAN, end, points: 48, fields: [field], live: true }));
  const v = (data?.series[field] ?? []).map((x) => (x == null ? null : Math.abs(x)));
  const known = v.filter((x): x is number => x != null);
  if (known.length < 2) return <div className={cn("h-7", className)} />;
  const lo = range?.[0] ?? Math.min(...known);
  const hi = Math.max(range?.[1] ?? Math.max(...known), lo + 1);
  const pts = v
    .map((x, i) =>
      x == null ? null : `${((i / (v.length - 1)) * 100).toFixed(2)},${(28 - ((x - lo) / (hi - lo)) * 26).toFixed(2)}`,
    )
    .filter(Boolean)
    .join(" ");
  return (
    <svg aria-hidden viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-7 w-full", className)}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A thin bar, filled to `share` (0–1). */
export function Meter({ share, color, className }: { share: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-track", className)}>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out-soft"
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: color }}
      />
    </div>
  );
}

/** A ring, filled to `share` (0–1), with what's in it in the middle. */
export function Ring({
  share,
  color,
  size = 96,
  stroke = 9,
  children,
}: {
  share: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0, Math.min(1, share)) * c} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-out-soft"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
