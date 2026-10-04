import { cn } from "~/features/common/ui/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import type { Moment } from "~/features/plan/utils/moments";

/** A moment's number in its colour, as it's marked on the chart and in the list. */
export const MomentNum = ({ m, className }: { m: Moment; className?: string }) => (
  <span
    className={cn("flex items-center justify-center rounded-full font-bold text-ink-inverse", className)}
    style={{ background: m.color }}
  >
    {m.num}
  </span>
);

/** How far the markers push a chart's plots down: a numbered dot each, above the lines. */
export const MARKER_ROW = 26;

/**
 * The moments marked across a chart: a numbered dot at the top and a dashed line down through the plots. Placed
 * absolutely in the chart's own box; `left` gives a time's position as a percentage of its width.
 */
export function MomentMarkers({ moments, left }: { moments: Moment[]; left: (t: number) => number }) {
  return moments.map((m) => (
    <div
      key={m.num}
      aria-hidden
      className="pointer-events-none absolute inset-y-0"
      style={{ left: `${left(m.t).toFixed(2)}%` }}
    >
      <MomentNum m={m} className="absolute top-0 left-0 size-5 -translate-x-1/2 text-[11px]" />
      <span className="absolute top-6 bottom-0 left-0 border-l border-dashed border-line-strong" />
    </div>
  ));
}

/**
 * The moments as a numbered list: time, then what happens. `day` labels each time ("Today", "Tomorrow")
 * where the list spans more than one day.
 */
export function MomentList({
  moments,
  day,
  className,
}: {
  moments: Moment[];
  day?: (t: number) => string;
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {moments.map((m) => (
        <li
          key={m.num}
          className="grid grid-cols-[24px_64px_minmax(0,1fr)] items-center gap-3 border-t border-line-subtle py-3 first:border-t-0 first:pt-0"
        >
          <MomentNum m={m} className="size-6 text-xs" />
          <span className="flex flex-col gap-px">
            <span className="text-[17px] leading-5 font-medium text-ink tabular-nums">{hhmm(m.t)}</span>
            {day && <span className="text-[11px] text-ink-label">{day(m.t)}</span>}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-[19px] font-medium text-ink">{m.title}</span>
            <span className="text-xs leading-[17px] text-ink-dim">{m.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
