import { useId, type Ref } from "react";
import { exportCsvUrl } from "~/features/history/api";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { useNow } from "~/features/common/time/hooks";
import { useForecast } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { longDate, weekdayLong } from "~/features/common/formatting/utils/date";
import { money } from "~/features/common/formatting/utils/number";
import { addDays } from "~/features/common/time/utils";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { DayChart } from "~/features/history/components/DayChart";
import type { Day } from "~/features/history/utils/year";

/** Today's weather, next to today's numbers. */
function WeatherChip() {
  const p = useSnapshot();
  const forecast = useForecast();
  const now = useNow();
  if (!p) return null;
  const wx = liveWeather(p, forecast, now);
  return (
    <div className="flex items-center gap-2 rounded-full bg-surface-raised py-1.5 pr-3 pl-2 text-[13px] text-ink-soft">
      {/* This chip has always shown a plain moon after dark, whatever the cloud. */}
      <Icon name={wx.mode === "night" ? "moon" : liveWeatherIcon(wx)} size={16} />
      {wx.label}
    </div>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-ink-dim">
        <i className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-[28px] leading-[30px] font-light tracking-[-1px] text-white tabular-nums">
        {value}
        {unit && <small className="ml-1 text-[13px] font-normal tracking-normal text-[#7a7a7a]">{unit}</small>}
      </span>
    </div>
  );
}

function DayStats({ day }: { day: Day }) {
  if (day.kind === "none")
    return <div className="col-span-full text-sm text-ink-dim">No readings were recorded on this day.</div>;
  if (day.kind !== "data") return null;
  return (
    <>
      <Stat label="Solar generated" value={day.gen.toFixed(1)} unit="kWh" color="#ffb547" />
      <Stat label="Home use" value={day.home.toFixed(1)} unit="kWh" color="#f5f5f5" />
      <Stat label="Self-sufficiency" value={String(Math.round(day.ss * 100))} unit="%" color="#3ee08f" />
      <Stat label="Saved" value={money(day.saved)} color="#9aa4ff" />
    </>
  );
}

/** The selected day in detail: its totals on the left, hour by hour on the right. */
export function DayPanel({
  day,
  isToday,
  onPrev,
  onNext,
  ref,
}: {
  day: Day;
  isToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  ref?: Ref<HTMLElement>;
}) {
  const dateId = useId();
  const dt = new Date(day.ts * 1000);
  const partial = day.kind === "data" && day.partial;
  return (
    <section
      ref={ref}
      aria-labelledby={dateId}
      className="grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-10 rounded-3xl border border-line-subtle bg-surface p-8 max-lg:grid-cols-1 max-lg:gap-7 max-lg:p-6 max-sm:p-5"
    >
      <div className="flex flex-col gap-6">
        <div className="flex min-h-9 items-center justify-between gap-3">
          {partial && <WeatherChip />}
          <div className="ml-auto flex gap-1.5">
            <Button variant="round" aria-label="Previous day" onClick={onPrev}>
              <Icon name="chevL" size={18} />
            </Button>
            <Button variant="round" aria-label="Next day" onClick={onNext} disabled={isToday}>
              <Icon name="chevR" size={18} />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[15px] text-ink-dim">
            {partial && "Today so far · "}
            {weekdayLong.format(dt)}
          </span>
          <span
            id={dateId}
            className="text-[36px] leading-10 font-light tracking-[-1.5px] text-balance text-white max-sm:text-[30px] max-sm:leading-[34px]"
          >
            {longDate.format(dt)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <DayStats day={day} />
        </div>
        <a
          href={exportCsvUrl(day.ts, addDays(day.ts, 1))}
          download
          className="mt-auto inline-flex items-center gap-2 text-[13px] font-semibold text-ink-muted no-underline hover:text-ink"
        >
          <Icon name="download" size={16} />
          Download this day as CSV
        </a>
      </div>
      <DayChart dayTs={day.ts} live={isToday} />
    </section>
  );
}
