import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, kWhInt, money, pct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { codeIcon, codeName, degrees, hourIconColor } from "~/features/common/weather/utils";
import type { PlanDay } from "~/features/plan/utils";

/** When the battery fills on a day, or how high it gets. */
function batteryLine({ battery: b, today }: PlanDay, now: number): string {
  if (b.now) return "Full now";
  if (b.fullAt) return b.fullAt <= now ? `Filled at ${hhmm(b.fullAt)}` : `Full by ${hhmm(b.fullAt)}`;
  return `${today ? "Highest" : "Tops out at"} ${pct(b.max)}`;
}

/** Today and the next two days side by side; choosing one shows its plan below. */
export function OutlookDays({
  days,
  selected,
  onSelect,
  now,
}: {
  days: PlanDay[];
  now: number;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const fahrenheit = useFahrenheit();
  return (
    <div role="tablist" aria-label="Day" className="grid grid-cols-3 gap-4 max-md:grid-cols-1 max-md:gap-3">
      {days.map((d, i) => {
        const icon = d.day.code != null ? codeIcon(d.day.code, true) : "cloudSun";
        const on = i === selected;
        const filled = d.battery.now || d.battery.fullAt != null;
        return (
          <button
            key={d.key}
            type="button"
            role="tab"
            id={`plan-tab-${i}`}
            aria-selected={on}
            aria-controls="plan-day"
            onClick={() => onSelect(i)}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col gap-4 rounded-2xl border bg-surface px-6 py-5 text-left transition-[translate,border-color,box-shadow] duration-200 ease-out-soft hover:-translate-y-0.5 active:translate-y-0 max-sm:px-5 max-sm:py-4",
              on ? "border-brand shadow-[0_0_0_1px_var(--color-brand)]" : "border-line-subtle hover:border-line-strong",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-semibold text-ink">{d.label}</span>
                <span className="text-xs text-ink-dim">{shortDay.format(new Date(d.start * 1000))}</span>
              </span>
              <span className="flex items-center gap-2 text-[13px] text-ink-soft tabular-nums">
                <span
                  title={d.day.code != null ? codeName(d.day.code) : undefined}
                  style={{ color: hourIconColor(icon) }}
                >
                  <Icon name={icon} size={22} />
                </span>
                {d.day.temp_max != null && d.day.temp_min != null && (
                  <span>
                    {degrees(d.day.temp_max, fahrenheit)}
                    <span className="text-ink-faint"> / {degrees(d.day.temp_min, fahrenheit)}</span>
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-ink-dim">{d.today ? "Solar today" : "Solar"}</span>
              <span className="text-[30px] leading-9 font-light tracking-[-0.5px] text-ink tabular-nums">
                {kWhInt(d.pv)}
              </span>
              <span className="text-xs text-ink-faint tabular-nums">
                {d.pvRange
                  ? `Likely ${Math.round(d.pvRange[0])}–${kWhInt(d.pvRange[1])}`
                  : d.day.precip >= 40
                    ? `${d.day.precip}% chance of rain`
                    : d.today
                      ? "Recorded today"
                      : " "}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px] tabular-nums">
              <dt className="text-ink-dim">Home use</dt>
              <dd className="text-right font-medium text-ink">{kWh(d.load + d.car)}</dd>
              <dt className="text-ink-dim">Battery</dt>
              <dd className="text-right font-medium" style={{ color: filled ? COLOR.battery : COLOR.ink }}>
                {batteryLine(d, now)}
              </dd>
              {d.car >= 0.05 && (
                <>
                  <dt className="text-ink-dim">Car charging</dt>
                  <dd className="text-right font-medium text-ink">{kWh(d.car)}</dd>
                </>
              )}
              <dt className="text-ink-dim">From the grid</dt>
              <dd className="text-right font-medium text-ink">{d.imp < 0.05 ? "None" : kWh(d.imp)}</dd>
              {d.cost != null && (
                <>
                  <dt className="text-ink-dim">Expected cost</dt>
                  <dd className="text-right font-medium" style={{ color: d.cost < 0 ? COLOR.good : COLOR.ink }}>
                    {money(d.cost)}
                  </dd>
                </>
              )}
            </dl>
          </button>
        );
      })}
    </div>
  );
}
