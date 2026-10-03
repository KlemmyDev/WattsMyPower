import { useQuery } from "@tanstack/react-query";
import { gridHoursQuery } from "~/features/bills/api";
import type { GridHours } from "~/features/bills/types";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { hourLabel, monthLong, monthShort, parseYmd } from "~/features/common/formatting/utils/date";
import { kWh, money, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

type Month = GridHours["months"][number];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const heatShade = (v: number) => alpha(COLOR.ink, +(0.04 + 0.84 * v).toFixed(2));
const emptyCell = "bg-transparent shadow-[inset_0_0_0_1px_var(--color-line)]";
const rowClass = "grid grid-cols-[44px_repeat(24,minmax(0,1fr))] items-center gap-[3px]";

/** Where the grid money went: the costliest hour and month, and the dearest band's share of the year. */
function note(g: GridHours): string {
  let best: { cost: number; hour: number; month: string } | null = null;
  let total = 0;
  let dear = 0;
  const peak = new Set(g.dearest?.hours ?? []);
  for (const m of g.months)
    for (const [hour, c] of (m.hours ?? []).entries()) {
      if (!c) continue;
      total += c.cost;
      if (peak.has(hour)) dear += c.cost;
      if (!best || c.cost > best.cost) best = { cost: c.cost, hour, month: m.month };
    }
  if (!best || total < 0.05) return "Almost no grid power bought in the months recorded so far.";
  const when = `The costliest hour is around ${hourLabel(best.hour)} in ${monthLong.format(parseYmd(best.month))}, at ${money(best.cost)} a day on average`;
  if (g.dearest && dear > 0)
    return `${when}. ${g.dearest.name} hours make up ${pct((dear / total) * 100)} of what grid power cost: moving use out of them saves the most.`;
  return `${when}. Running big loads in the middle of the day, on solar, cuts it.`;
}

/** What grid power cost by hour of the day and month: where on the clock the bill comes from. */
export function GridCostHeatmap() {
  const { data: g } = useQuery(gridHoursQuery);
  const cells = (g?.months ?? []).flatMap((m) => m.hours ?? []).filter((c) => c != null);
  // Scale to the costliest cell, but never below 20c so a near-zero month doesn't read as heavy use.
  const top = Math.max(0.2, ...cells.map((c) => c.cost));
  const peak = new Set(g?.dearest?.hours ?? []);
  return (
    <Card aria-labelledby="h-hm">
      <TitleBlock
        id="h-hm"
        title="When grid power costs you"
        sub={`What grid power cost by hour on an average day, each of the last 12 months.${g?.dearest ? ` ${g.dearest.name} hours are outlined.` : ""}`}
      />
      {!g ? (
        <Muted>Loading</Muted>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="flex min-w-[760px] flex-col gap-[3px]">
              {g.months.map((m) => (
                <HeatRow key={m.month} month={m} top={top} peak={peak} />
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
            <Muted className="max-w-[640px]">{note(g)}</Muted>
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
        </>
      )}
    </Card>
  );
}

function HeatRow({ month, top, peak }: { month: Month; top: number; peak: Set<number> }) {
  const mon = monthShort.format(parseYmd(month.month));
  return (
    <div className={rowClass}>
      <span className="font-mono text-[11px] text-ink-faint">{mon}</span>
      {HOURS.map((h) => {
        const c = month.hours?.[h];
        const outline = peak.has(h) ? "outline outline-1 -outline-offset-1 outline-bad/60" : "";
        return c ? (
          <div
            key={h}
            className={cn("h-[22px] rounded", outline)}
            style={{ background: heatShade(c.cost / top) }}
            title={`${mon} ${hourLabel(h)}: ${money(c.cost)} a day on average (${kWh(c.kwh)})`}
          />
        ) : (
          <div key={h} className={cn("h-[22px] rounded", emptyCell)} title={`${mon} ${hourLabel(h)}: no readings`} />
        );
      })}
    </div>
  );
}
