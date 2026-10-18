import { reserveOf } from "~/features/common/energy/utils";
import { useSystem } from "~/features/common/live/hooks/useSystem";
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
import { DASH, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import { addDays, dateKey } from "~/features/common/time/utils";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { DayChart } from "~/features/history/components/DayChart";
import { DayWeather, DayWeatherChip } from "~/features/history/components/DayWeather";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { HeroStat, HeroStats } from "~/features/common/ui/components/Hero";
import { extremesOf } from "~/features/history/utils/day";
import type { Day } from "~/features/history/utils/year";

const FIELDS = ["pv_power", "load_power", "grid_power", "battery_soc", "battery_power"];

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

/** The day's figures, four across (two on phones): what it made and used, how it did, the grid, and its extremes. */
function DayStats({ day, extremes }: { day: Day; extremes: ReturnType<typeof extremesOf> }) {
  if (day.kind === "none")
    return <div className="text-[13px] text-ink-faint">No readings were recorded on this day.</div>;
  if (day.kind !== "data") return null;
  const { peak, low } = extremes;
  return (
    <HeroStats>
      <HeroStat label="Made" value={kWh(day.gen)} sub={peak ? `Peak ${kW(peak.w)} at ${hhmm(peak.t)}` : undefined} />
      <HeroStat label="Used" value={kWh(day.home)} />
      <HeroStat label="Self-sufficiency" value={pct(day.ss * 100)} />
      <HeroStat label="Saved" value={money(day.saved)} />
      <HeroStat label="Bought" value={kWh(day.imp)} sub={day.cost >= 0.005 ? money(day.cost) : undefined} />
      <HeroStat
        label="Exported"
        value={kWh(day.exp)}
        sub={day.credit >= 0.005 ? `${money(day.credit)} back` : undefined}
      />
      <HeroStat label="Lowest battery" value={low != null ? pct(low) : DASH} />
      <HeroStat label="Power bill" value={money(day.net)} sub="With the supply charge" />
    </HeroStats>
  );
}

/** The chosen day in detail: its figures, hour by hour, and its weather; stepping a day either way. */
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
  const reserve = reserveOf(useSystem());
  const q = useQuery({
    ...historyQuery({ start: day.ts, end: addDays(day.ts, 1), points: 288, fields: FIELDS, live: isToday }),
    placeholderData: keepPreviousData,
  });
  // While the next day loads, the previous one's readings stay up; don't pair them with the new day's numbers.
  const series = q.isPlaceholderData ? undefined : q.data?.series;
  const extremes = useMemo(() => extremesOf(series), [series]);
  return (
    <Card
      ref={ref}
      id="day"
      aria-labelledby={dateId}
      // Brought into view when a day's chosen, or at "#day" (the Overview's "Today in History").
      className="scroll-mt-28"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <TitleBlock
          id={dateId}
          title={longDate.format(dt)}
          sub={`${partial ? "Today so far · " : ""}${weekdayLong.format(dt)}`}
        />
        <div className="flex items-center gap-2">
          {partial ? <WeatherChip /> : <DayWeatherChip date={dateKey(day.ts)} />}
          <Button variant="round" aria-label="Previous day" onClick={onPrev} disabled={!onPrev}>
            <Icon name="chevL" size={18} />
          </Button>
          <Button variant="round" aria-label="Next day" onClick={onNext} disabled={!onNext}>
            <Icon name="chevR" size={18} />
          </Button>
        </div>
      </div>
      <DayStats day={day} extremes={extremes} />
      <DayChart series={q.data?.series} placeholder={q.isPlaceholderData} reserve={reserve} />
      <DayWeather date={dateKey(day.ts)} made={day.kind === "data" && !partial ? day.gen : null} />
      <a
        href={exportCsvUrl(day.ts, addDays(day.ts, 1))}
        download
        className="inline-flex items-center gap-2 self-start text-[13px] font-medium text-ink-muted no-underline hover:text-ink"
      >
        <Icon name="download" size={16} />
        Download this day as CSV
      </a>
    </Card>
  );
}
