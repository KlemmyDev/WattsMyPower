import { useQuery } from "@tanstack/react-query";
import { billsQuery } from "~/features/bills/api";
import { periodStart } from "~/features/bills/utils";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { dollars } from "~/features/common/formatting/utils/number";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, nowS, partsOf, siteTime } from "~/features/common/time/utils";

/**
 * Bills → Rates & settings, this bill as a picture: where today is in the billing period, and what the bill has come
 * to so far and is expected to, against the budget (a mark on the bar) when there is one.
 */
export function BillPeriodVisual() {
  const s = useSystem();
  const bills = useQuery(billsQuery).data;
  if (!s) return null;
  const now = nowS();
  const start = periodStart(now, s.bill_months, s.bill_day, s.bill_anchor);
  const from = partsOf(start);
  const next = siteTime(from.year, from.month + s.bill_months, s.bill_day);
  const last = addDays(next, -1);
  const length = Math.round((next - start) / 86_400);
  const day = Math.min(Math.floor((now - start) / 86_400) + 1, length);
  const soFar = bills?.current.so_far.net_cost ?? null;
  const expected = bills?.current.expected?.net_cost ?? null;
  const budget = bills?.budget ?? (s.bill_budget || null);
  const scale = Math.max(expected ?? 0, soFar ?? 0, budget ?? 0) * 1.08 || 1;
  const pct = (v: number) => `${Math.max(0, Math.min((v / scale) * 100, 100))}%`;
  const over = budget != null && expected != null && expected > budget;

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[28px] leading-8 font-light tracking-[-0.6px] tabular-nums">
            Day {day} <span className="text-lg text-ink-muted">of {length}</span>
          </span>
          <span className="text-[13px] text-ink-muted">Next bill {dayMonth(next)}</span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-track">
          <div
            className="h-full origin-left animate-fill-x rounded-full"
            style={{ width: `${(day / length) * 100}%`, background: COLOR.good }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-ink-faint tabular-nums">
          <span>{dayMonth(start)}</span>
          <span>{dayMonth(last)}</span>
        </div>
      </div>

      {soFar != null && (
        <div className="flex flex-col gap-2 border-t border-line-subtle pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[13px] font-semibold">This bill</span>
            <span className="text-[13px] text-ink-muted tabular-nums">
              {dollars(soFar)} so far
              {expected != null && <> · heading for {dollars(expected)}</>}
            </span>
          </div>
          <div className="relative h-3">
            <div className="absolute inset-0 overflow-hidden rounded-full bg-track">
              {expected != null && (
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: pct(expected), background: alpha(over ? COLOR.bad : COLOR.good, 0.3) }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 origin-left animate-fill-x rounded-full"
                style={{ width: pct(soFar), background: over ? COLOR.bad : COLOR.good }}
              />
            </div>
            {budget != null && (
              <div
                className="absolute -inset-y-1 w-0.5 rounded-full bg-ink"
                style={{ left: pct(budget) }}
                title={`Budget ${dollars(budget)}`}
              />
            )}
          </div>
          <span className="text-xs text-ink-faint">
            {budget != null
              ? expected != null
                ? `${dollars(Math.abs(expected - budget))} ${over ? "over" : "under"} your ${dollars(budget)} budget, as it's going.`
                : `Your budget is ${dollars(budget)} a bill.`
              : "Set a budget below to see this bill against it."}
          </span>
        </div>
      )}
    </>
  );
}
