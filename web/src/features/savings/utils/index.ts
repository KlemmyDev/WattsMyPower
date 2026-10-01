import type { Savings } from "~/features/savings/types";
import { DASH, dollars, pct } from "~/features/common/formatting/utils/number";
import { monthYearLong } from "~/features/common/formatting/utils/date";

type Payback = Savings["payback"];

export type PaybackSummary = {
  /** Share of the system cost saved so far, e.g. "64%". */
  figure: string;
  /** Width of the progress bar, 0–100. */
  progress: number;
  note: string;
  /** Months until the system has paid for itself; 0 once paid off, null when unknown. */
  months: number | null;
};

/** How far the system is towards paying for itself, as of `now` (unix seconds). */
export function summarisePayback(p: Payback, now: number): PaybackSummary {
  const { system_cost: cost, saved_lifetime: saved, per_month: perMonth } = p;
  if (!cost)
    return {
      figure: DASH,
      progress: 0,
      months: null,
      note: "Enter what your solar and battery system cost to see when it pays for itself.",
    };
  if (saved == null)
    return { figure: DASH, progress: 0, months: null, note: "Waiting for your inverter's lifetime totals." };

  const frac = saved / cost;
  const figure = pct(Math.min(1, frac) * 100);
  const progress = Math.max(0, Math.min(100, frac * 100));
  if (frac >= 1)
    return {
      figure,
      progress,
      months: 0,
      note: `Paid off. Your system has saved about ${dollars(saved - cost)} more than it cost.`,
    };
  if (perMonth != null && perMonth > 0) {
    const months = Math.ceil((cost - saved) / perMonth);
    const d = new Date(now * 1000);
    d.setMonth(d.getMonth() + months, 1);
    return {
      figure,
      progress,
      months,
      note: `Paid off by about ${monthYearLong.format(d)} at your current savings rate`,
    };
  }
  return { figure, progress, months: null, note: "The payoff date appears after your first full day of readings." };
}
