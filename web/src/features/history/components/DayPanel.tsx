import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useId, useMemo, type Ref } from "react";
import { exportCsvUrl } from "~/features/history/api";
import { historyQuery } from "~/features/common/readings/api";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { useNow } from "~/features/common/time/hooks";
import { useFahrenheit, useForecast } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { hhmm, longDate, weekdayLong } from "~/features/common/formatting/utils/date";
import { energyParts, money, powerParts } from "~/features/common/formatting/utils/number";
import { addDays, dateKey } from "~/features/common/time/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { DayChart } from "~/features/history/components/DayChart";
import { DayWeather, DayWeatherChip } from "~/features/history/components/DayWeather";
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
  const fahrenheit = useFahrenheit();
  if (!p) return null;
  const wx = liveWeather(p, forecast, now, fahrenheit);
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
      <span className="text-[28px] leading-[30px] font-light tracking-[-1px] text-fg tabular-nums">
        {value}
        {unit && <small className="ml-1 text-[13px] font-normal tracking-normal text-ink-label">{unit}</small>}
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
      <Stat label="Solar generated" {...energy(day.gen)} color={COLOR.solar} />
      <Stat label="Home use" {...energy(day.home)} color={COLOR.ink} />
      <Stat label="Self-sufficiency" value={String(Math.round(day.ss * 100))} unit="%" color={COLOR.good} />
      <Stat label="Saved" value={money(day.saved)} color={COLOR.import} />
      <Stat label="From the grid" {...energy(day.imp)} color={COLOR.fromGrid} />
      <Stat label="Sent to the grid" {...energy(day.exp)} color={COLOR.export} />
      <Stat
        label="Peak solar"
        value={peakValue}
        unit={peak ? `${peakUnit} at ${hhmm(peak.t)}` : undefined}
        color={COLOR.solar}
      />
      <Stat label="Lowest battery" value={low != null ? String(Math.round(low)) : "—"} unit="%" color={COLOR.battery} />
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
          {partial ? <WeatherChip /> : <DayWeatherChip date={dateKey(day.ts)} />}
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
            className="text-[36px] leading-10 font-light tracking-[-1.5px] text-balance text-fg max-sm:text-[30px] max-sm:leading-[34px]"
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
      <div className="flex min-w-0 flex-col gap-4">
        <DayChart series={q.data?.series} hours={hours} placeholder={q.isPlaceholderData} />
        <DayWeather date={dateKey(day.ts)} made={day.kind === "data" && !partial ? day.gen : null} />
      </div>
    </section>
  );
}
