import type { Bills } from "~/features/bills/types";
import { barScale, ymdLabel } from "~/features/bills/utils";
import { Key } from "~/features/bills/components/BillParts";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { kWhInt, money } from "~/features/common/formatting/utils/number";
import { dayMonth, parseYmd } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

const addDays = (ymd: string, n: number) => {
  const d = parseYmd(ymd);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
};

const CREDIT = alpha(COLOR.good, 0.6);

/** What each day of this period cost, against the daily average, and the costliest days. */
export function DailyCost({ bills }: { bills: Bills | undefined }) {
  if (!bills) return null;
  const { period, days } = bills;
  const whole = days.filter((d) => !d.partial);
  const avgOf = whole.length ? whole : days;
  const avg = avgOf.length ? avgOf.reduce((a, d) => a + d.net_cost, 0) / avgOf.length : 0;
  const sc = barScale([avg * 1.08, ...days.map((d) => d.net_cost * 1.08)]);
  const top = [...whole].sort((a, b) => b.net_cost - a.net_cost).slice(0, 3);
  return (
    <Card aria-labelledby="h-daily" className="col-span-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TitleBlock
          id="h-daily"
          title="Daily cost this period"
          sub="Grid usage plus supply charge, minus feed-in credit, for each day"
        />
        <div className="flex flex-wrap gap-4 text-xs text-ink-muted">
          <Key swatch={<i className="w-3.5 border-t border-dashed border-ink" />}>Daily average {money(avg)}</Key>
          <Key swatch={<Swatch color={CREDIT} size={10} />}>Credit day</Key>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-2">
          <div className="relative flex h-[200px] gap-0.5" role="img" aria-label="Daily cost this period">
            <div className="absolute inset-x-0 h-px bg-fg/14" style={{ top: `${sc.zero.toFixed(2)}%` }} />
            {Array.from({ length: period.days }, (_, k) => {
              const d = days[k];
              const label = dayMonth(addDays(period.start, k).getTime() / 1000);
              if (!d)
                return (
                  <div key={k} title={`${label}: still to come`} className="relative min-w-0 flex-1">
                    <div
                      className="absolute inset-x-0 h-[1%] rounded-[3px] bg-fg/8"
                      style={{ top: `${(sc.zero - 0.5).toFixed(2)}%` }}
                    />
                  </div>
                );
              const { top: y, height } = sc.bar(d.net_cost);
              const color = d.net_cost < 0 ? CREDIT : d.partial ? COLOR.ink : COLOR.bar;
              return (
                <div
                  key={k}
                  title={`${label}${d.partial ? " (today so far)" : ""}: ${money(d.net_cost)}`}
                  className="relative min-w-0 flex-1"
                >
                  <div
                    className="absolute inset-x-0 rounded-[3px]"
                    style={{ top: `${y.toFixed(2)}%`, height: `${height.toFixed(2)}%`, background: color }}
                  />
                </div>
              );
            })}
            {days.length > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink/70"
                style={{ top: `${sc.y(avg).toFixed(2)}%` }}
              />
            )}
          </div>
          <div className="flex justify-between font-mono text-[11px] text-ink-faint">
            <span>{ymdLabel(period.start)}</span>
            <span>{dayMonth(addDays(period.start, Math.floor(period.days / 2)).getTime() / 1000)}</span>
            <span>{ymdLabel(period.end)}</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          <span className="text-[15px] font-semibold text-ink">Biggest cost days</span>
          {top.length === 0 && (
            <span className="py-3 text-[13px] text-ink-faint">Shows up after the first full day of this period</span>
          )}
          {top.map((d, i) => (
            <div
              key={d.date}
              className="grid grid-cols-[24px_1fr_auto] items-start gap-3 border-b border-line-subtle py-3 tabular-nums"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-track text-xs font-semibold text-ink">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{ymdLabel(d.date)}</span>
                <span className="text-xs leading-[18px] text-pretty text-ink-faint">
                  {d.pv_kwh != null ? `${kWhInt(d.pv_kwh)} of solar · ` : ""}
                  {kWhInt(d.import_kwh)} from the grid
                </span>
              </div>
              <span className="text-sm font-semibold text-ink">{money(d.net_cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
