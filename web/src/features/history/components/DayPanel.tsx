import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useId, useMemo, type Ref } from "react";
import { exportCsvUrl } from "~/features/history/api";
import { historyQuery } from "~/features/common/readings/api";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { useNow } from "~/features/common/time/hooks";
import { useForecast } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { hhmm, longDate, weekdayLong } from "~/features/common/formatting/utils/date";
import { energyParts, money, powerParts } from "~/features/common/formatting/utils/number";
import { addDays } from "~/features/common/time/utils";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { DayChart } from "~/features/history/components/DayChart";
import { HCARD } from "~/features/history/components/parts";
import { cn } from "~/features/common/ui/utils";
import { extremesOf, hoursOf } from "~/features/history/utils/day";
import type { Day } from "~/features/history/utils/year";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc"];

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

/** A day's figure and unit: "26.6" kWh, or "395" Wh under one. */
const energy = (v: number) => {
  const [value, unit] = energyParts(v);
  return { value, unit };
};

function DayStats({ day, extremes }: { day: Day; extremes: ReturnType<typeof extremesOf> }) {
  if (day.kind === "none")
    return <div className="col-span-full text-sm text-ink-dim">No readings were recorded on this day.</div>;
  if (day.kind !== "data") return null;
  const { peak, low } = extremes;
  const [peakValue, peakUnit] = peak ? powerParts(peak.w) : ["—", ""];
  return (
    <>
      <Stat label="Solar generated" {...energy(day.gen)} color="#ffb547" />
      <Stat label="Home use" {...energy(day.home)} color="#f5f5f5" />
      <Stat label="Self-sufficiency" value={String(Math.round(day.ss * 100))} unit="%" color="#3ee08f" />
      <Stat label="Saved" value={money(day.saved)} color="#9aa4ff" />
      <Stat label="From the grid" {...energy(day.imp)} color="#8a8a90" />
      <Stat label="Sent to the grid" {...energy(day.exp)} color="#f2a65a" />
      <Stat
        label="Peak solar"
        value={peakValue}
        unit={peak ? `${peakUnit} at ${hhmm(peak.t)}` : undefined}
        color="#ffb547"
      />
      <Stat label="Lowest battery" value={low != null ? String(Math.round(low)) : "—"} unit="%" color="#6f8cff" />
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
  /** Undefined at the ends of the view. */
  onPrev?: () => void;
  onNext?: () => void;
  ref?: Ref<HTMLElement>;
}) {
  const dateId = useId();
  const dt = new Date(day.ts * 1000);
  const partial = day.kind === "data" && day.partial;
  const q = useQuery({
    ...historyQuery({ start: day.ts, end: addDays(day.ts, 1), points: 288, fields: FIELDS, live: isToday }),
    placeholderData: keepPreviousData,
  });
  // While the next day loads, the previous one's readings stay up; don't pair them with the new day's numbers.
  const series = q.isPlaceholderData ? undefined : q.data?.series;
  const hours = useMemo(() => hoursOf(series, day.ts), [series, day.ts]);
  const extremes = useMemo(() => extremesOf(series), [series]);
  return (
    <section
      ref={ref}
      aria-labelledby={dateId}
      className={cn(HCARD, "grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] gap-10 max-lg:grid-cols-1 max-lg:gap-6")}
    >
      <div className="flex flex-col gap-6">
        <div className="flex min-h-9 items-center justify-between gap-3">
          {partial && <WeatherChip />}
          <div className="ml-auto flex gap-1.5">
            <Button variant="round" aria-label="Previous day" onClick={onPrev} disabled={!onPrev}>
              <Icon name="chevL" size={18} />
            </Button>
            <Button variant="round" aria-label="Next day" onClick={onNext} disabled={!onNext}>
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
          <DayStats day={day} extremes={extremes} />
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
      <DayChart series={q.data?.series} hours={hours} placeholder={q.isPlaceholderData} />
    </section>
  );
}
