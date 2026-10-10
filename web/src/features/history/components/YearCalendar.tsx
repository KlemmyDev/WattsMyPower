import { memo, useMemo, useState } from "react";
import { monthShort, monthYearLong } from "~/features/common/formatting/utils/date";
import { dateKey, mondayFirst, partsOf, siteTime } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Cell } from "~/features/history/utils/year";

/** The selected day: a canvas-coloured gap, then a full-contrast ring. */
const RING = "shadow-[0_0_0_2px_var(--color-canvas),0_0_0_3.5px_var(--color-fg)]";

type GridProps = {
  cells: Cell[];
  /** Blank cells before the first day, so weeks run Monday to Sunday. */
  lead: number;
  selected: number;
  onSelect: (ts: number) => void;
};

const SHAPE = {
  heat: "aspect-square w-full rounded-[4px]",
  month: "h-4 w-full rounded-[3px]",
};

function DayCell({
  cell,
  shape,
  selected,
  onSelect,
  className,
}: {
  cell: Cell | null;
  shape: keyof typeof SHAPE;
  selected: boolean;
  onSelect: (ts: number) => void;
  className?: string;
}) {
  const base = cn("border-0 p-0 transition-[background] duration-240 ease-[ease]", SHAPE[shape], className);
  // Padding before the first day keeps its space but isn't drawn.
  if (!cell) return <span className={cn(base, "invisible")} />;
  if (!cell.label) return <span className={cn(base, "bg-transparent inset-ring inset-ring-fg/3")} />;
  return (
    <button
      type="button"
      title={cell.label}
      aria-label={cell.label}
      onClick={() => onSelect(cell.ts)}
      className={cn(
        base,
        !cell.fill && "bg-transparent",
        selected ? cn("relative z-1", RING) : !cell.fill && "inset-ring inset-ring-fg/6",
      )}
      style={cell.fill ? { background: cell.fill } : undefined}
    />
  );
}

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

/** Wider screens: the view as week columns, Monday at the top, scrolling sideways when narrow. */
export const YearHeatmap = memo(function YearHeatmap({ cells, lead, selected, onSelect }: GridProps) {
  const nWeeks = Math.ceil((lead + cells.length) / 7);
  const months: { col: number; label: string }[] = [];
  for (const c of cells) {
    const dt = new Date(c.ts * 1000);
    if (partsOf(dt).day !== 1 && c.i !== 0) continue;
    const col = Math.floor((c.i + lead) / 7);
    // Skip a label that would crowd the one before it or run off the end.
    if (col <= nWeeks - 3 && (!months.length || col - months[months.length - 1].col > 2))
      months.push({ col, label: monthShort.format(dt) });
  }
  return (
    <div className="overflow-x-auto max-md:hidden">
      {/* The padding leaves room for the selected day's ring. */}
      <div className="flex min-w-[640px] flex-col gap-3 p-1">
        <div className="relative ml-9 h-4">
          {months.map((m) => (
            <span
              key={m.col}
              className="absolute font-mono text-[11px] text-ink-label"
              style={{ left: `${((m.col / nWeeks) * 100).toFixed(2)}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="grid w-7 flex-none grid-rows-[repeat(7,minmax(0,1fr))] items-center gap-1 font-mono text-[10px] text-ink-faint">
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div
            className="grid min-w-0 flex-1 grid-flow-col grid-rows-[repeat(7,auto)] gap-1"
            style={{ gridTemplateColumns: `repeat(${nWeeks}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: lead }, (_, i) => (
              <DayCell key={`pad${i}`} cell={null} shape="heat" selected={false} onSelect={onSelect} />
            ))}
            {cells.map((c) => (
              <DayCell key={c.i} cell={c} shape="heat" selected={c.i === selected} onSelect={onSelect} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Phones: one month at a time, Monday to Sunday across, with each day's date on its cell.
 * It follows the selected day until the reader steps to another month.
 */
export function MonthCalendar({
  cells,
  selected,
  onSelect,
  sub,
}: {
  cells: Cell[];
  selected: number;
  onSelect: (ts: number) => void;
  sub: string;
}) {
  const months = useMemo(() => {
    const out: { key: string; title: string; cells: Cell[] }[] = [];
    for (const c of cells) {
      const dt = new Date(c.ts * 1000);
      const key = dateKey(c.ts).slice(0, 7);
      if (out[out.length - 1]?.key !== key) out.push({ key, title: monthYearLong.format(dt), cells: [] });
      out[out.length - 1].cells.push(c);
    }
    return out;
  }, [cells]);
  // The month the reader stepped to, and the day that was selected when they did.
  const [stepped, setStepped] = useState<{ key: string; from: number } | null>(null);
  if (!months.length) return null;
  const selIdx = Math.max(
    0,
    months.findIndex((m) => m.cells.some((c) => c.i === selected)),
  );
  const steppedIdx = stepped && stepped.from === selected ? months.findIndex((m) => m.key === stepped.key) : -1;
  const idx = steppedIdx >= 0 ? steppedIdx : selIdx;
  const month = months[idx];
  const go = (k: number) => setStepped({ key: months[k].key, from: selected });
  // The whole month, even where the view starts partway through it or stops at today.
  const first = partsOf(month.cells[0].ts);
  const lead = mondayFirst(siteTime(first.year, first.month, 1));
  const byDate = new Map(month.cells.map((c) => [partsOf(c.ts).day, c]));
  const length = partsOf(siteTime(first.year, first.month + 1, 0)).day;

  return (
    <section aria-label="Month calendar" className="hidden flex-col gap-4 max-md:flex">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="round"
          className="size-11"
          aria-label="Previous month"
          disabled={idx === 0}
          onClick={() => go(idx - 1)}
        >
          <Icon name="chevL" size={18} />
        </Button>
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-xl font-semibold text-ink">{month.title}</span>
          <span className="text-xs text-ink-dim">{sub}</span>
        </div>
        <Button
          variant="round"
          className="size-11"
          aria-label="Next month"
          disabled={idx === months.length - 1}
          onClick={() => go(idx + 1)}
        >
          <Icon name="chevR" size={18} />
        </Button>
      </div>
      {/* Squares like the desktop heatmap, in a compact grid; each day's date is in its label. */}
      <div className="grid grid-cols-[repeat(7,32px)] justify-center gap-1.5">
        {WEEKDAY_INITIALS.map((w, i) => (
          <span key={i} className="text-center font-mono text-[11px] text-ink-faint">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length }, (_, k) => k + 1).map((num) => {
          const c = byDate.get(num);
          const base = "size-8 rounded-md border-0 p-0";
          // Outside the view (before it starts, or after today): just a faint outline.
          if (!c) return <span key={`out${num}`} className={cn(base, "inset-ring inset-ring-fg/9")} />;
          if (!c.label) return <span key={c.i} className={cn(base, "inset-ring inset-ring-fg/9")} />;
          return (
            <button
              key={c.i}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={c.i === selected}
              onClick={() => onSelect(c.ts)}
              className={cn(
                base,
                !c.fill && "bg-transparent",
                c.i === selected ? cn("relative z-1", RING) : !c.fill && "inset-ring inset-ring-fg/16",
              )}
              style={c.fill ? { background: c.fill } : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
