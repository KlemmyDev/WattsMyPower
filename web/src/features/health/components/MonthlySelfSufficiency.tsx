import type { CSSProperties } from "react";
import type { Insights } from "~/features/health/types";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { monthShort, monthYear, parseYmd } from "~/features/common/formatting/utils/date";
import { pct, plural } from "~/features/common/formatting/utils/number";

/** One bar per month, the current month highlighted. */
export function MonthlySelfSufficiency({ months }: { months: Insights["months"] }) {
  const last = months.length - 1;
  return (
    <Card aria-labelledby="h-ssm">
      <TitleBlock
        id="h-ssm"
        title="Self-sufficiency by month"
        sub="Share of home use covered by solar and the battery"
      />
      <div className="flex h-[220px] items-end gap-2 max-sm:gap-[3px] compact:h-[150px]">
        {months.map((m, k) => {
          const label = monthYear.format(parseYmd(m.month));
          const v = m.self_pct;
          const cur = k === last;
          return (
            <div
              key={m.month}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
              title={
                v == null
                  ? `${label}: no readings`
                  : `${label}: ${pct(v)} self-sufficient over ${m.days} ${plural(m.days, "day")} of readings`
              }
            >
              <span
                className={cn(
                  "font-mono text-[11px] whitespace-nowrap tabular-nums max-sm:text-[9px] max-sm:tracking-[-0.3px]",
                  cur ? "text-ink" : "text-ink-faint",
                )}
              >
                {v == null ? "" : pct(v)}
              </span>
              {/* 86% leaves room for the label above a full bar. */}
              <i
                className={cn("bar-grow block w-full max-w-9 rounded-md", cur ? "bg-ink" : "bg-bar-muted")}
                style={{ height: `${v == null ? 0 : (v * 0.86).toFixed(1)}%`, "--i": k } as CSSProperties}
              />
            </div>
          );
        })}
      </div>
      <div className="-mt-2 flex gap-2 max-sm:gap-[3px]">
        {months.map((m) => (
          <span
            key={m.month}
            className="min-w-0 flex-1 text-center font-mono text-[11px] text-ink-faint max-sm:text-[9px] max-sm:tracking-[-0.3px]"
          >
            {monthShort.format(parseYmd(m.month))}
          </span>
        ))}
      </div>
    </Card>
  );
}
