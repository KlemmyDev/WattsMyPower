import type { ReactNode } from "react";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, hourOf } from "~/features/common/time/utils";
import { dayLength } from "~/features/common/time/utils/sun";
import { Card } from "~/features/common/ui/components/Card";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { TimeLine } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { hourIcon, liveWeather } from "~/features/common/weather/utils";
import { DaylightStrip, sunAt } from "~/features/solar/components/DaylightStrip";
import { Delta, EXPECTED, Figure, LiveDot, SOLAR } from "~/features/solar/components/parts";
import { expectedToday, place, signedPct, solarNow, solarToday } from "~/features/solar/utils";
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
    <Card
      aria-label="Solar today and now"
      className="h-full gap-6"
      style={{
        backgroundImage: `linear-gradient(180deg, ${alpha(tint, live.producing ? 0.1 : 0.06)}, transparent 45%)`,
      }}
    >
      {/* On a phone the rows below come apart (contents) so the pace bar can sit right under what's been made. */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 max-sm:contents">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5 max-sm:contents">
          <div className="flex flex-col gap-1.5 max-sm:-order-2">
            <span className="text-[13px] text-ink-muted">Made today</span>
            <Figure value={madeValue} unit={madeUnit} size="xl" />
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted tabular-nums">
              {today.made == null
                ? "No reading yet"
                : done
                  ? "Done for the day"
                  : today.heading != null && `Heading for ${kWh(today.heading)} by midnight`}
              {today.pace != null && (
                <Delta value={today.pace}>{signedPct(today.pace)} on this morning's forecast</Delta>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 border-l border-line-subtle pl-6 max-sm:border-l-0 max-sm:pl-0">
            <span className="flex items-center gap-2 text-[13px] text-ink-muted">
              <LiveDot on={live.producing} color={tint} />
              {live.producing ? "Generating now" : "Panels resting"}
            </span>
            <Figure value={value} unit={unit} />
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted tabular-nums">
              {live.array
                ? live.producing && live.share != null
                  ? `${pct(live.share * 100)} of your ${live.array} kW array`
                  : `${live.array} kW array`
                : null}
              {live.vsExpected != null && (
                <Delta value={live.vsExpected}>{signedPct(live.vsExpected)} on expected</Delta>
              )}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-x-8 gap-y-3 max-md:grid-cols-2">
          <Stat
            label="Peak"
            value={today.peak ? kW(today.peak.w) : DASH}
            sub={today.peak ? `at ${hhmm(today.peak.t)}` : "Not yet today"}
          />
          <Stat label="Tomorrow" value={today.tomorrow ? kWh(today.tomorrow.pv_kwh) : DASH} sub="Forecast" />
          <Daylight sun={today.sun} now={now} />
          <Stat
            label="Sky"
            value={today.cloud != null ? `${Math.round(today.cloud)}%` : (sky?.name ?? DASH)}
            sub={today.cloud != null ? [sky?.name, sky?.temp].filter(Boolean).join(" · ") : (sky?.temp ?? undefined)}
          />
        </dl>
      </div>
      <Pace today={today} done={done} className="max-sm:-order-1" />
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
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-[20px] leading-6 font-light tracking-[-0.3px] whitespace-nowrap tabular-nums">{value}</dd>
      {sub && <dd className="truncate text-[11.5px] text-ink-faint">{sub}</dd>}
    </div>
  );
}

/** The daylight: how much is left while the sun's up, when it rises before then, and the day's length after. */
function Daylight({ sun, now }: { sun: Today["sun"]; now: number }) {
  if (!sun || sun.rise == null || sun.set == null) return <Stat label="Daylight" value={DASH} />;
  if (now < sun.rise)
    return <Stat label="Sunrise" value={hhmm(sun.rise)} sub={`${dayLength(sun.hours, true)} of daylight`} />;
  if (now < sun.set)
    return <Stat label="Daylight left" value={dayLength((sun.set - now) / 3600, true)} sub={`Sets ${hhmm(sun.set)}`} />;
  return <Stat label="Daylight" value={dayLength(sun.hours, true)} sub={`${hhmm(sun.rise)} to ${hhmm(sun.set)}`} />;
}

/**
 * Today's pace along one bar out of where it's heading: made so far (the figure above it), the rest the forecast
 * expects (dashed), the range it likely lands in, and a tick for this morning's forecast.
 */
function Pace({ today: t, done, className }: { today: Today; done: boolean; className?: string }) {
  const whole = Math.max(t.heading ?? 0, t.planned ?? 0, t.likely?.high ?? 0, t.made ?? 0, 0.1);
  const at = (v: number) => `${Math.min(100, (v / whole) * 100)}%`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-2.5 rounded-full bg-track">
        {t.likely && (
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              left: at(t.likely.low),
              width: `calc(${at(t.likely.high)} - ${at(t.likely.low)})`,
              background: alpha(SOLAR, 0.18),
            }}
          />
        )}
        {t.heading != null && !done && (
          <span
            className="absolute inset-y-0 left-0 rounded-full border border-dashed"
            style={{ width: at(t.heading), borderColor: alpha(SOLAR, 0.7) }}
          />
        )}
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft"
          style={{ width: at(t.made ?? 0), background: SOLAR }}
        />
        {t.planned != null && (
          <span
            title="This morning's forecast"
            className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: at(t.planned) }}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-faint tabular-nums">
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full" style={{ background: SOLAR }} />
          Made so far
        </span>
        {t.planned != null && (
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-0.5 rounded-full bg-ink" />
            {kWh(t.planned)} forecast this morning
          </span>
        )}
        {t.heading != null && !done && (
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-full border border-dashed" style={{ borderColor: SOLAR }} />
            {t.likely
              ? `Likely ${t.likely.low.toFixed(1)} to ${kWh(t.likely.high)} by midnight`
              : `${kWh(t.heading)} by midnight`}
          </span>
        )}
      </div>
    </div>
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
