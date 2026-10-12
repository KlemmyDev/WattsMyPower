import { monthShort } from "~/features/common/formatting/utils/date";
import { DASH, kWhInt, money, pct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { siteTime } from "~/features/common/time/utils";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { cn } from "~/features/common/ui/utils";
import type { Month } from "~/features/history/utils/year";

/** Where the house's power came from, bottom up, in the bars and along the hero's bar. */
export const SOURCES = [
  { key: "direct", label: "Solar", color: COLOR.solar },
  { key: "battery", label: "Battery", color: COLOR.battery },
  { key: "imp", label: "Grid", color: COLOR.import },
] as const;

/** A round top for the chart: the next multiple of a step that suits the size. */
function niceMax(v: number) {
  const step = v > 1000 ? 200 : v > 200 ? 50 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

/**
 * The year January to December, a bar a month: the house's use stacked by where it came from (solar, the battery, the
 * grid). Hover reads a month out; choosing one opens its days. Months without readings keep their place.
 */
export function MonthBars({ year, months, onSelect }: { year: number; months: Month[]; onSelect: (m: Month) => void }) {
  const { hover: h, width, plot, bar } = useBarHover();
  const byKey = new Map(months.map((m) => [m.key, m]));
  const slots = Array.from({ length: 12 }, (_, k) => ({
    label: monthShort.format(siteTime(year, k + 1, 15) * 1000),
    m: byKey.get(`${year}-${String(k + 1).padStart(2, "0")}`) ?? null,
  }));
  const top = niceMax(Math.max(0, ...months.map((m) => m.home)));
  const pc = (v: number) => `${((v / top) * 100).toFixed(2)}%`;
  const sel = h != null ? slots[h].m : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[220px] pr-12 max-sm:h-[180px] max-sm:pr-10 compact:h-[160px]" {...plot}>
        {[1, 0.5].map((q) => (
          <div
            key={q}
            className="pointer-events-none absolute inset-x-0 border-t border-fg/5"
            style={{ top: `${(1 - q) * 100}%` }}
          >
            <span className="absolute -top-[7px] right-0 text-[10.5px] leading-[14px] text-ink-faint tabular-nums">
              {kWhInt(top * q)}
            </span>
          </div>
        ))}
        <div className="relative grid h-full grid-cols-12 gap-1.5 max-sm:gap-1">
          {slots.map(({ label, m }, k) =>
            m ? (
              <button
                key={k}
                type="button"
                {...bar(k)}
                aria-label={`${m.name} ${m.year}: ${kWhInt(m.home)} used. Show its days`}
                onClick={() => onSelect(m)}
                className={cn(
                  "flex h-full min-w-0 cursor-pointer flex-col justify-end border-0 bg-transparent p-0 transition-opacity duration-200",
                  h != null && h !== k && "opacity-45",
                )}
              >
                <span
                  className="mx-auto flex w-full max-w-14 flex-col-reverse overflow-hidden rounded-[5px] transition-[height] duration-700 ease-out-soft"
                  style={{ height: pc(m.home) }}
                >
                  {SOURCES.map((s) => (
                    <span key={s.key} style={{ flexGrow: m[s.key], background: s.color }} />
                  ))}
                </span>
              </button>
            ) : (
              <span key={k} aria-label={`${label}: no readings`} className="flex h-full flex-col justify-end">
                <span className="mx-auto h-1 w-full max-w-14 rounded-full bg-fg/6" />
              </span>
            ),
          )}
        </div>
        {sel && h != null && (
          <ChartTooltip left={((h + 0.5) / 12) * 100} flip={h > 5} width={width}>
            <span className="font-medium text-ink">
              {sel.name} {sel.year}
            </span>
            <TooltipRow label="Used" value={kWhInt(sel.home)} />
            {SOURCES.map((s) => (
              <TooltipRow key={s.key} label={s.label} value={kWhInt(sel[s.key])} color={s.color} />
            ))}
            <TooltipRow label="Sent to the grid" value={kWhInt(sel.exp)} color={COLOR.export} />
            <TooltipRow
              label="Self-sufficiency"
              value={sel.home > 0 ? pct(((sel.direct + sel.battery) / sel.home) * 100) : DASH}
            />
            <TooltipRow label="Saved" value={money(sel.saved)} />
          </ChartTooltip>
        )}
      </div>
      <div className="grid grid-cols-12 gap-1.5 pr-12 max-sm:gap-1 max-sm:pr-10">
        {slots.map(({ label, m }, k) => (
          <span
            key={k}
            className={cn(
              "min-w-0 overflow-hidden text-center text-[11px] max-sm:text-[9.5px]",
              h === k ? "text-ink" : m ? "text-ink-muted" : "text-ink-faint",
            )}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
