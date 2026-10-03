import type { HeatCell, Insights } from "~/features/insights/types";
import type { SystemInfo } from "~/features/common/live/types";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { reserveOf } from "~/features/common/energy/utils";
import { hourLabel, monthLong, monthShort, parseYmd } from "~/features/common/formatting/utils/date";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

type Month = Insights["months"][number];
type Busiest = { cell: NonNullable<HeatCell>; hour: number; month: Month };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const heatShade = (v: number) => alpha(COLOR.ink, +(0.04 + 0.84 * v).toFixed(2));
const emptyCell = "bg-transparent shadow-[inset_0_0_0_1px_var(--color-line)]";

/** The hour and month with the most grid import (the first one, on a tie). */
function busiest(months: Month[]): Busiest | null {
  let best: Busiest | null = null;
  for (const month of months)
    for (const [hour, cell] of (month.heat ?? []).entries())
      if (cell && (!best || cell.kwh > best.cell.kwh)) best = { cell, hour, month };
  return best;
}

function heatNote(best: Busiest | null, system: SystemInfo | undefined): string {
  if (!best) return "No readings yet. This fills in as your system records data.";
  if (best.cell.kwh < 0.1) return "You have used almost no grid power in the hours recorded so far.";
  const reserve = reserveOf(system);
  const when = `Most grid power is used around ${hourLabel(best.hour)} in ${monthLong.format(parseYmd(best.month.month))}`;
  if (best.cell.soc != null && best.cell.soc <= reserve + 5)
    return `${when}, after the battery runs down to its ${pct(reserve)} reserve. Keeping more charge for the evening would reduce this.`;
  if (best.hour >= 9 && best.hour < 16) return `${when}, when solar is not covering home use.`;
  return `${when}, while the battery still has charge. Running several large appliances at once can draw more than the battery's ${system?.battery_max_kw || 5} kW output.`;
}

export function GridHeatmap({ months, system }: { months: Month[]; system: SystemInfo | undefined }) {
  const cells = months.flatMap((m) => m.heat ?? []).filter((c) => c != null);
  // Scale to the busiest cell, but never below 0.2 kWh so a near-zero month doesn't read as heavy use.
  const hmax = Math.max(0.2, ...cells.map((c) => c.kwh));
  return (
    <Card aria-labelledby="h-hm">
      <TitleBlock
        id="h-hm"
        title="When you use grid power"
        sub="Average grid import by hour and month, last 12 months. Bolder cells mean more energy from the grid."
      />
      <div className="overflow-x-auto">
        <div className="flex min-w-[760px] flex-col gap-[3px]">
          {months.map((m) => (
            <HeatRow key={m.month} month={m} hmax={hmax} />
          ))}
          <div className={cn(rowClass, "mt-1")}>
            <span />
            {HOURS.map((h) => (
              <span key={h} className="font-mono text-[10px] text-ink-faint">
                {h % 3 ? "" : String(h).padStart(2, "0")}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Muted className="max-w-[640px]">{heatNote(busiest(months), system)}</Muted>
        <div className="flex items-center gap-1.5 text-xs text-ink-faint">
          <i className={cn("h-3 w-4 rounded-[3px]", emptyCell)} />
          No data
          <span className="w-2" />
          Less
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <i key={v} className="h-3 w-4 rounded-[3px]" style={{ background: heatShade(v) }} />
          ))}
          More
        </div>
      </div>
    </Card>
  );
}

const rowClass = "grid grid-cols-[44px_repeat(24,minmax(0,1fr))] items-center gap-[3px]";

function HeatRow({ month, hmax }: { month: Month; hmax: number }) {
  const mon = monthShort.format(parseYmd(month.month));
  return (
    <div className={rowClass}>
      <span className="font-mono text-[11px] text-ink-faint">{mon}</span>
      {HOURS.map((h) => {
        const c = month.heat?.[h];
        return c ? (
          <div
            key={h}
            className="h-[22px] rounded"
            style={{ background: heatShade(c.kwh / hmax) }}
            title={`${mon} ${hourLabel(h)}: ${kWh(c.kwh)} average`}
          />
        ) : (
          <div key={h} className={cn("h-[22px] rounded", emptyCell)} title={`${mon} ${hourLabel(h)}: no readings`} />
        );
      })}
    </div>
  );
}
