import { periodStart } from "~/features/bills/utils";
import { dayMonth, monthShort } from "~/features/common/formatting/utils/date";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, nowS, partsOf, siteTime } from "~/features/common/time/utils";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { BillingFields } from "~/features/settings/components/BillingSettings";

/**
 * Step 5: the billing period, saved as it changes (the defaults are calendar quarters), beside the year's bills as
 * they'd fall: this one filling up to today, the rest after it.
 */
export function BillingStep({ nav }: StepProps) {
  return (
    <>
      <StepIntro nav={nav} title="Your billing period">
        Match the dates on your electricity bill, so bill estimates line up with what your retailer charges.
      </StepIntro>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5 rounded-2xl bg-canvas/60 p-5 light:bg-canvas">
              <BillingYear />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <BillingFields rows color={COLOR.lilac} />
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter nav={nav} />
    </>
  );
}

/**
 * The next year of bills as blocks along a line of months, each as long as its period: this bill washed in the step's
 * colour and filled to today, the ones after it quieter. They rearrange as the frequency or start day changes.
 */
function BillingYear() {
  const s = useSystem();
  if (!s) return null;
  const months = s.bill_months || 3;
  const now = nowS();
  const start = periodStart(now, months, s.bill_day, s.bill_anchor);
  const from = partsOf(start);
  const periods = Array.from({ length: Math.round(12 / months) }, (_, k) => ({
    a: siteTime(from.year, from.month + k * months, s.bill_day),
    b: siteTime(from.year, from.month + (k + 1) * months, s.bill_day),
  }));
  const length = Math.round((periods[0].b - start) / 86_400);
  const day = Math.min(Math.floor((now - start) / 86_400) + 1, length);
  const c = COLOR.lilac;
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[28px] leading-8 font-light tracking-[-0.6px] tabular-nums">
          Day {day} <span className="text-lg text-ink-muted">of {length}</span>
        </span>
        <span className="text-[13px] text-ink-muted">Next bill {dayMonth(periods[0].b)}</span>
      </div>
      <div className="flex flex-col gap-2">
        {/* Keyed by the settings, so a change lays the year out afresh. */}
        <div key={`${months} ${s.bill_day} ${s.bill_anchor}`} className="flex h-20 gap-1.5">
          {periods.map(({ a, b }, k) => {
            const on = k === 0;
            return (
              <div
                key={a}
                className="relative flex min-w-0 animate-pop flex-col justify-end overflow-hidden rounded-xl px-2.5 py-2"
                style={{
                  flex: b - a,
                  background: on ? alpha(c, 0.16) : alpha(COLOR.fg, 0.05),
                  animationDelay: `${k * 50}ms`,
                }}
              >
                {on && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 origin-left animate-fill-x"
                    style={{
                      width: `${(day / length) * 100}%`,
                      background: alpha(c, 0.28),
                      boxShadow: `inset -2px 0 0 ${c}`,
                    }}
                  />
                )}
                {months > 1 && (
                  <span className="relative flex min-w-0 flex-col">
                    <span className="truncate text-xs font-semibold" style={on ? { color: c } : undefined}>
                      {on ? "This bill" : `Bill ${k + 1}`}
                    </span>
                    <span className="truncate text-[11px] text-ink-muted tabular-nums">{dayMonth(a)}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div aria-hidden className="flex text-[11px] text-ink-faint">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="flex-1 text-center">
              {monthShort.format(siteTime(from.year, from.month + i, 15) * 1000).slice(0, 1)}
            </span>
          ))}
        </div>
      </div>
      <p className="m-0 text-[13px] leading-5 text-pretty text-ink-muted">
        {Math.round(12 / months)} bills a year. This one runs {dayMonth(start)} to {dayMonth(addDays(periods[0].b, -1))}
        , and it's day {day}.
      </p>
    </>
  );
}
