import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { addDays, hourOf } from "~/features/common/time/utils";
import { dayLength } from "~/features/common/time/utils/sun";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { TimeLine } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { hourIcon, liveWeather } from "~/features/common/weather/utils";
import { DaylightStrip, sunAt } from "~/features/solar/components/DaylightStrip";
import {
  HeroBar,
  HeroCard,
  HeroFigures,
  HeroFill,
  HeroKey,
  HeroLead,
  HeroLive,
  HeroStat,
  HeroStats,
  HeroTick,
  HeroTop,
} from "~/features/common/ui/components/Hero";
import { Delta } from "~/features/common/ui/components/Live";
import { EXPECTED, SOLAR } from "~/features/solar/components/parts";
import { expectedToday, place, solarNow, solarToday } from "~/features/solar/utils";
import type { WeatherDay, WeatherHour } from "~/features/weather/types";

type Today = ReturnType<typeof solarToday>;

/**
 * Solar today and now, in one card: what the panels have made today and where it's heading (against this morning's
 * forecast), what they're making now (against the array and what the forecast expected for this hour), the day's
 * peak, tomorrow, the daylight and the sky; and, unless `chart` is off, the day's solar against what was expected, with the sky hour by
 * hour and the sun under it.
 */
export function SolarHero({
  p,
  s,
  f,
  acc,
  series,
  weather,
  start,
  now,
  chart = true,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  series: HistorySeries | undefined;
  weather: WeatherDay | undefined;
  start: number;
  now: number;
  chart?: boolean;
}) {
  const live = solarNow(p, s, f, now);
  const today = solarToday({ p, s, f, acc, series, weather, now });
  const fahrenheit = useFahrenheit();
  const sky = p ? liveWeather(p, f, now, fahrenheit) : null;
  const at = place(s);
  // The sun's orange while the panels make power; resting, the moon's blue.
  const tint = live.producing ? SOLAR : COLOR.moon;
  const [value, unit] = kW(live.pv).split(" ");
  const [madeValue, madeUnit] = today.made != null ? kWh(today.made).split(" ") : [DASH];
  // Nothing more expected today: the sun's down, or the forecast has no more to come.
  const done = today.made != null && today.heading != null && today.heading - today.made < 0.05;
  return (
    <HeroCard label="Solar today and now" tint={tint} wash={live.producing ? 0.1 : 0.06}>
      <HeroTop>
        <HeroFigures>
          <HeroLead
            label="Made today"
            value={madeValue}
            unit={madeUnit}
            sub={
              <>
                {today.made == null
                  ? "No reading yet"
                  : done
                    ? "Done for the day"
                    : today.heading != null && `Heading for ${kWh(today.heading)} by midnight`}
                {today.pace != null && (
                  <Delta value={today.pace}>{signedPct(today.pace)} on this morning's forecast</Delta>
                )}
              </>
            }
          />
          <HeroLive
            label={live.producing ? "Generating now" : "Panels resting"}
            on={live.producing}
            color={tint}
            value={value}
            unit={unit}
            sub={
              <>
                {live.array
                  ? live.producing && live.share != null
                    ? `${pct(live.share * 100)} of your ${live.array} kW array`
                    : `${live.array} kW array`
                  : null}
                {live.vsExpected != null && (
                  <Delta value={live.vsExpected}>{signedPct(live.vsExpected)} on expected</Delta>
                )}
              </>
            }
          />
        </HeroFigures>
        <HeroStats>
          <HeroStat
            label="Peak"
            value={today.peak ? kW(today.peak.w) : DASH}
            sub={today.peak ? `at ${hhmm(today.peak.t)}` : "Not yet today"}
          />
          <HeroStat label="Tomorrow" value={today.tomorrow ? kWh(today.tomorrow.pv_kwh) : DASH} sub="Forecast" />
          <Daylight sun={today.sun} now={now} />
          <HeroStat
            label="Sky"
            value={today.cloud != null ? `${Math.round(today.cloud)}%` : (sky?.name ?? DASH)}
            sub={today.cloud != null ? [sky?.name, sky?.temp].filter(Boolean).join(" · ") : (sky?.temp ?? undefined)}
          />
        </HeroStats>
      </HeroTop>
      <Pace today={today} done={done} />
      {chart &&
        (series ? (
          <TimeLine
            label="Solar through the day, against what was expected"
            points={series.t.map((t, i) => ({ t, v: series.pv_power?.[i] ?? null }))}
            compare={{ points: expectedToday(weather, f, now), color: EXPECTED }}
            start={start}
            end={addDays(start, 1)}
            now={now}
            color={SOLAR}
            fill
            height={260}
            domain={[0, 1000]}
            every={3}
            empty="No solar readings today yet."
            tip={(pt, other) => (
              <>
                <span className="font-medium text-ink">{hhmm(pt.t)}</span>
                {pt.v != null && <TooltipRow label="Solar" value={kW(pt.v)} color={SOLAR} />}
                {other?.v != null && <TooltipRow label="Expected" value={kW(other.v)} color={EXPECTED} />}
                {at && <TooltipRow label="Sun" value={sunAt(pt.t, at.lat, at.lon)} />}
              </>
            )}
            under={(from, to) => (
              <div className="flex flex-col gap-1">
                {weather && <SkyRow hours={weather.hours} from={from} to={to} />}
                {at && <DaylightStrip start={from} end={to} now={now} lat={at.lat} lon={at.lon} />}
              </div>
            )}
          />
        ) : (
          <Skeleton className="h-[340px] rounded-2xl" />
        ))}
    </HeroCard>
  );
}

/** The daylight: how much is left while the sun's up, when it rises before then, and the day's length after. */
function Daylight({ sun, now }: { sun: Today["sun"]; now: number }) {
  if (!sun || sun.rise == null || sun.set == null) return <HeroStat label="Daylight" value={DASH} />;
  if (now < sun.rise)
    return <HeroStat label="Sunrise" value={hhmm(sun.rise)} sub={`${dayLength(sun.hours, true)} of daylight`} />;
  if (now < sun.set)
    return (
      <HeroStat label="Daylight left" value={dayLength((sun.set - now) / 3600, true)} sub={`Sets ${hhmm(sun.set)}`} />
    );
  return <HeroStat label="Daylight" value={dayLength(sun.hours, true)} sub={`${hhmm(sun.rise)} to ${hhmm(sun.set)}`} />;
}

/**
 * Today's pace along one bar out of where it's heading: made so far (the figure above it), the rest the forecast
 * expects (dashed), the range it likely lands in, and a tick for this morning's forecast.
 */
function Pace({ today: t, done }: { today: Today; done: boolean }) {
  const whole = Math.max(t.heading ?? 0, t.planned ?? 0, t.likely?.high ?? 0, t.made ?? 0, 0.1);
  const at = (v: number) => Math.min(100, (v / whole) * 100);
  return (
    <HeroBar
      legend={
        <>
          <HeroKey mark="dot" color={SOLAR}>
            Made so far
          </HeroKey>
          {t.planned != null && <HeroKey mark="tick">{kWh(t.planned)} forecast this morning</HeroKey>}
          {t.heading != null && !done && (
            <HeroKey mark="dashed" color={SOLAR}>
              {t.likely
                ? `Likely ${t.likely.low.toFixed(1)} to ${kWh(t.likely.high)} by midnight`
                : `${kWh(t.heading)} by midnight`}
            </HeroKey>
          )}
        </>
      }
    >
      {t.likely && <HeroFill from={at(t.likely.low)} to={at(t.likely.high)} color={SOLAR} variant="faint" />}
      {t.heading != null && !done && <HeroFill to={at(t.heading)} color={SOLAR} variant="dashed" />}
      <HeroFill to={at(t.made ?? 0)} color={SOLAR} />
      {t.planned != null && <HeroTick at={at(t.planned)} title="This morning's forecast" />}
    </HeroBar>
  );
}

/** The sky hour by hour on the chart's time scale: the weather's icon and how cloudy it is. */
function SkyRow({ hours, from, to }: { hours: WeatherHour[]; from: number; to: number }) {
  const shown = hours.filter((h) => h.is_day && h.code != null && h.ts + 1800 >= from && h.ts + 1800 <= to);
  if (!shown.length) return null;
  return (
    <div className="relative h-9" aria-hidden>
      {shown.map((h, i) => (
        <span
          key={h.ts}
          title={`${hourLabel(hourOf(h.ts))}${h.cloud != null ? `, ${Math.round(h.cloud)}% cloud` : ""}`}
          className={cn(
            "absolute flex -translate-x-1/2 flex-col items-center gap-0.5",
            // Every other hour on a phone, where they'd crowd.
            i % 2 === 1 && "max-md:hidden",
          )}
          style={{ left: `${((h.ts + 1800 - from) / (to - from)) * 100}%` }}
        >
          <Icon name={hourIcon({ code: h.code!, is_day: 1 })} size={15} className="text-ink-muted" />
          <span className="font-mono text-[10px] text-ink-faint tabular-nums">
            {h.cloud != null ? `${Math.round(h.cloud)}%` : ""}
          </span>
        </span>
      ))}
    </div>
  );
}
