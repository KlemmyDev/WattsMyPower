import { memo } from "react";
import { monthShort } from "~/features/common/formatting/utils/date";
import { cn } from "~/features/common/ui/utils";
import type { Cell } from "~/features/history/utils/year";

type GridProps = {
  cells: Cell[];
  /** Blank cells before 1 January, so weeks run Monday to Sunday. */
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
  // Padding before 1 January keeps its space but isn't drawn.
  if (!cell) return <span className={cn(base, "invisible")} />;
  if (!cell.label)
    return <span className={cn(base, "bg-transparent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]")} />;
  return (
    <button
      type="button"
      title={cell.label}
      aria-label={cell.label}
      onClick={() => onSelect(cell.ts)}
      className={cn(
        base,
        !cell.fill && "bg-transparent",
        selected
          ? "relative z-1 shadow-[0_0_0_2px_#0a0a0a,0_0_0_3.5px_#ffffff]"
          : !cell.fill && "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
      )}
      style={cell.fill ? { background: cell.fill } : undefined}
    />
  );
}

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

/** Desktop: the year as 53 week columns, Monday at the top, scrolling sideways when narrow. */
export const YearHeatmap = memo(function YearHeatmap({ cells, lead, selected, onSelect }: GridProps) {
  const nWeeks = Math.ceil((lead + cells.length) / 7);
  const months: { col: number; label: string }[] = [];
  for (const c of cells) {
    const dt = new Date(c.ts * 1000);
    if (dt.getDate() !== 1 && c.i !== 0) continue;
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
              className="absolute font-mono text-[11px] text-[#7a7a7a]"
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
 * Phones: the same days flipped on their side, a row per week (Monday to Sunday across),
 * January at the top, with the month named where each month starts.
 */
export const MonthGrid = memo(function MonthGrid({ cells, lead, selected, onSelect }: GridProps) {
  const weeks: (Cell | null)[][] = [];
  for (const c of cells) {
    const w = Math.floor((c.i + lead) / 7);
    (weeks[w] ??= Array<Cell | null>(7).fill(null))[(c.i + lead) % 7] = c;
  }
  const rows: { week: (Cell | null)[]; month: string | null }[] = [];
  let prevMonth: string | null = null;
  for (const week of weeks) {
    const latest = week.findLast((c) => c !== null);
    const month: string | null = latest ? monthShort.format(new Date(latest.ts * 1000)) : prevMonth;
    rows.push({ week, month: month !== prevMonth ? month : null });
    prevMonth = month;
  }
  return (
    <div className="hidden grid-cols-[34px_repeat(7,minmax(0,1fr))] items-center gap-[3px] max-md:grid">
      <span />
      {WEEKDAY_INITIALS.map((w, i) => (
        <span key={i} className="pb-0.5 text-center font-mono text-[10px] text-ink-faint">
          {w}
        </span>
      ))}
      {rows.map(({ week, month }, w) => {
        // A little space where each month begins.
        const start = month ? "mt-2" : undefined;
        return [
          <span key={`m${w}`} className={cn("font-mono text-[10px] text-ink-dim", start)}>
            {month}
          </span>,
          ...week.map((c, d) => (
            <DayCell
              key={c ? c.i : `pad${w}-${d}`}
              cell={c}
              shape="month"
              selected={c?.i === selected}
              onSelect={onSelect}
              className={start}
            />
          )),
        ];
      })}
    </div>
  );
});
