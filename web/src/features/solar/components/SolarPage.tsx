import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { ON } from "~/features/common/energy/utils";
import { hhmm, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct, powerParts } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Breakdown } from "~/features/common/ui/components/Breakdown";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit, useForecast, useForecastAccuracy } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { codeIcon, codeName, degrees, liveWeather } from "~/features/common/weather/utils";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarPerformance, SolarTrend } from "~/features/solar/components/SolarHealth";
import { weatherDayQuery } from "~/features/weather/api";
import type { WeatherDay } from "~/features/weather/types";

const SOLAR = COLOR.solar;
const EXPECTED = alpha(COLOR.fg, 0.45);
const FIELDS = ["pv_power", "pv1_power", "pv2_power", "mppt1_v", "mppt1_a", "mppt2_v", "mppt2_a"];

/**
 * Solar: what the panels are making now and through today against what the forecast expected, where today's went,
 * each inverter and string, the days ahead, the last 30 days against the forecast, and how the panels are holding up.
 */
export function SolarPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const s = useSystem();
  const f = useForecast();
  const acc = useForecastAccuracy();
  const start = midnight(now);
  const { data: day } = useQuery(
    historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }),
  );
  const { data: weather } = useQuery(weatherDayQuery(dateKey(now)));
  const { data: insights } = useQuery(solarInsightsQuery);
  const series = day?.series;
  return (
    <>
      <PageHeader title="Solar" sub="What your panels are making, what they should, and how they're holding up" />
      <div className="flex flex-col gap-5">
        <SolarNow p={p} s={s} f={f} acc={acc} series={series} now={now} />
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-5">
            <TodayCard series={series} f={f} weather={weather} start={start} now={now} />
            <LastDays acc={acc} />
            {insights ? (
              <SolarPerformance performance={insights.performance} />
            ) : (
              <Skeleton className="h-[300px] rounded-3xl" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <WhereItWent p={p} />
            <Strings p={p} s={s} />
            <DaysAhead f={f} acc={acc} now={now} />
            {insights && <SolarTrend trend={insights.trend} />}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- now

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="text-[22px] leading-7 font-light tracking-[-0.4px] text-ink tabular-nums">{value}</span>
      {sub && <span className="truncate text-xs text-ink-faint">{sub}</span>}
    </div>
  );
}

/** Solar now, big: how much of the array it is, then today so far, where it should end up, its peak, and the sky. */
function SolarNow({
  p,
  s,
  f,
  acc,
  series,
  now,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  series: HistorySeries | undefined;
  now: number;
}) {
  const pv = p?.pv_power;
  const [value, unit] = pv == null ? [DASH, ""] : powerParts(pv);
  const array = s?.pv_kw;
  const share = pv != null && array ? pv / (array * 1000) : null;
  const made = p?.daily_pv ?? null;
  const today = f?.days.find((d) => d.date === dateKey(now));
  const expected = made != null && today ? made + today.pv_kwh : null;
  const range = acc?.range;
  const likely =
    made != null && today && range && today.pv_kwh > 0.1
      ? `likely ${kWh(made + today.pv_kwh * range.low)} to ${kWh(made + today.pv_kwh * range.high)}`
      : null;
  const peak = (() => {
    const t = series?.t ?? [];
    const v = series?.pv_power ?? [];
    let at = -1;
    for (let i = 0; i < t.length; i++) if (v[i] != null && (at < 0 || v[i]! > v[at]!)) at = i;
    return at >= 0 && (v[at] ?? 0) > ON ? { t: t[at], w: v[at]! } : null;
  })();
  const fahrenheit = useFahrenheit();
  const sky = p ? liveWeather(p, f, now, fahrenheit) : null;
  const producing = pv != null && pv > ON;
  return (
    <section
      className="relative flex flex-wrap items-center gap-x-10 gap-y-6 overflow-hidden rounded-3xl border border-line-subtle bg-surface p-7 max-sm:rounded-[20px] max-sm:p-5"
      style={{ backgroundImage: `linear-gradient(110deg, ${alpha(SOLAR, producing ? 0.13 : 0.05)}, transparent 55%)` }}
    >
      <div className="flex items-center gap-5">
        <span
          className="flex size-14 flex-none items-center justify-center rounded-[18px]"
          style={{ background: alpha(SOLAR, 0.16), color: SOLAR }}
        >
          <Icon name={producing ? "sun" : "moon"} size={26} />
        </span>
        <div className="flex flex-col">
          <span className="flex items-baseline gap-1.5 text-[52px] leading-[56px] font-light tracking-[-2px] tabular-nums max-sm:text-[42px] max-sm:leading-[48px]">
            {value}
            <span className="text-lg font-normal tracking-normal text-ink-faint">{unit}</span>
          </span>
          <span className="text-[13px] text-ink-muted">
            {producing
              ? share != null
                ? `${pct(share * 100)} of your ${array} kW array`
                : "Making power now"
              : "Resting: no sun on the panels"}
          </span>
        </div>
      </div>
      <div className="grid min-w-[min(100%,26rem)] flex-1 grid-cols-4 gap-x-6 gap-y-4 max-lg:grid-cols-2">
        <Stat label="Made today" value={kWh(made)} sub={peak ? `Peak ${kW(peak.w)} at ${hhmm(peak.t)}` : undefined} />
        <Stat label="By midnight" value={expected != null ? kWh(expected) : DASH} sub={likely ?? "From the forecast"} />
        <Stat
          label="Tomorrow"
          value={(() => {
            const t = f?.days.find((d) => d.date === dateKey(addDays(midnight(now), 1)));
            return t ? kWh(t.pv_kwh) : DASH;
          })()}
          sub="Forecast"
        />
        <Stat label="The sky" value={sky ? sky.name : DASH} sub={sky?.temp ?? undefined} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- today

/**
 * What the forecast expected for each hour of today, in W at the middle of the hour: the hours gone from the stored
 * day-ahead forecast, the hours to come from the forecast now.
 */
function expectedToday(weather: WeatherDay | undefined, f: Forecast | null | undefined, now: number): LinePoint[] {
  const hour = Math.floor(now / 3600) * 3600;
  const gone = (weather?.hours ?? [])
    .filter((h) => h.ts < hour && h.pv_forecast != null)
    .map((h) => ({ t: h.ts + 1800, v: (h.pv_forecast ?? 0) * 1000 }));
  const ahead = (f?.hours ?? []).filter((h) => h.ts >= hour).map((h) => ({ t: h.ts + 1800, v: h.pv_kw * 1000 }));
  return [...gone, ...ahead].sort((a, b) => a.t - b.t);
}

function TodayCard({
  series,
  f,
  weather,
  start,
  now,
}: {
  series: HistorySeries | undefined;
  f: Forecast | null | undefined;
  weather: WeatherDay | undefined;
  start: number;
  now: number;
}) {
  const actual: LinePoint[] = series ? series.t.map((t, i) => ({ t, v: series.pv_power?.[i] ?? null })) : [];
  const expected = expectedToday(weather, f, now);
  const planned = weather?.summary.pv_forecast_kwh;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          title="Today"
          sub={
            planned
              ? `Solar as it came, against the ${kWh(planned)} the forecast expected this morning`
              : "Solar as it came, against what the forecast expected"
          }
        />
        <div className="flex gap-4 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: SOLAR }} />
            Solar
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-3.5 border-t-2 border-dashed" style={{ borderColor: EXPECTED }} />
            Expected
          </span>
        </div>
      </div>
      {series ? (
        <TimeLine
          points={actual}
          compare={{ points: expected, color: EXPECTED }}
          start={start}
          end={addDays(start, 1)}
          now={now}
          color={SOLAR}
          fill
          height={200}
          domain={[0, 1000]}
          every={3}
          empty="No solar readings today yet."
          tip={(pt, other) => (
            <>
              <span className="font-medium text-ink">{hhmm(pt.t)}</span>
              {pt.v != null && <TooltipRow label="Solar" value={kW(pt.v)} color={SOLAR} />}
              {other?.v != null && <TooltipRow label="Expected" value={kW(other.v)} color={EXPECTED} />}
            </>
          )}
        />
      ) : (
        <Skeleton className="h-[220px] rounded-2xl" />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- where it went

/**
 * Where today's solar went: into the house, into the battery, or out to the grid. Export and charging can come from
 * elsewhere too (the battery to the grid, the grid to the battery), so each is capped at what solar could have given.
 */
function WhereItWent({ p }: { p: Snapshot | null }) {
  const pv = p?.daily_pv ?? 0;
  const toGrid = Math.min(p?.daily_export ?? 0, pv);
  const toBattery = Math.min(p?.daily_charge ?? 0, pv - toGrid);
  const home = Math.max(0, pv - toGrid - toBattery);
  const parts = [
    { key: "home", label: "Used at home", kwh: home, color: COLOR.teal },
    { key: "battery", label: "Into the battery", kwh: toBattery, color: COLOR.battery },
    { key: "grid", label: "Sent to the grid", kwh: toGrid, color: COLOR.export },
  ];
  const kept = pv > 0 ? (home + toBattery) / pv : null;
  return (
    <Card>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock title="Where it went" sub="Today's solar so far" />
        {kept != null && (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-ink-faint">Kept at home</span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{pct(kept * 100)}</span>
          </div>
        )}
      </div>
      {pv > 0 ? (
        <Breakdown parts={parts} total={pv} />
      ) : (
        <div className="text-[13px] text-ink-faint">No solar yet today.</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- strings

function Bar({ share, color }: { share: number; color: string }) {
  return (
    <span className="h-1 overflow-hidden rounded-full bg-fg/7">
      <span
        className="block h-full rounded-full transition-[width] duration-700 ease-out-soft"
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: color }}
      />
    </span>
  );
}

/**
 * Each inverter's solar (with a second, AC-coupled one), and the hybrid's strings: each MPPT's voltage and current,
 * and the power that makes. A string well behind the other on a sunny day is shade, a fault or dirt on its panels.
 */
function Strings({ p, s }: { p: Snapshot | null; s: SystemInfo | undefined }) {
  const strings = [1, 2]
    .map((n) => {
      const v = p?.[`mppt${n}_v`] ?? null;
      const a = p?.[`mppt${n}_a`] ?? null;
      return { n, v, a, w: v != null && a != null ? v * a : null };
    })
    .filter((x) => x.v != null && x.v > 0);
  const top = Math.max(1, ...strings.map((x) => x.w ?? 0));
  const pv2 = s?.pv2;
  const inverters = pv2
    ? [
        { name: s?.model ?? "Hybrid", w: p?.pv1_power ?? null, kwh: p?.daily_pv1 ?? null, temp: p?.inverter_temp },
        {
          name: [pv2.brand, pv2.model].filter(Boolean).join(" ") || "Second inverter",
          w: p?.pv2_power ?? null,
          kwh: p?.daily_pv2 ?? null,
          temp: p?.pv2_temp,
        },
      ]
    : [];
  const total = Math.max(1, ...inverters.map((x) => x.w ?? 0));
  if (!strings.length && !inverters.length) return null;
  return (
    <Card>
      <TitleBlock
        title={inverters.length ? "Inverters and strings" : "Strings"}
        sub={
          strings.length
            ? "Each string of panels as the inverter tracks it (MPPT). One well behind the other in full sun is shade, dirt or a fault."
            : "Each inverter's solar now"
        }
      />
      {inverters.length > 0 && (
        <ul className="flex flex-col gap-3">
          {inverters.map((x) => (
            <li key={x.name} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate text-ink">{x.name}</span>
                <span className="text-xs text-ink-faint tabular-nums">
                  {x.kwh != null ? `${kWh(x.kwh)} today` : ""}
                  {x.temp != null ? ` · ${Math.round(x.temp)}°C` : ""}
                </span>
                <span className="w-16 text-right text-ink tabular-nums">{kW(x.w)}</span>
              </div>
              <Bar share={(x.w ?? 0) / total} color={SOLAR} />
            </li>
          ))}
        </ul>
      )}
      {strings.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {strings.map((x) => (
            <div key={x.n} className="flex flex-col gap-2 rounded-2xl bg-fg/4 px-4 py-3">
              <span className="flex items-baseline justify-between text-xs text-ink-muted">
                String {x.n}
                <span className="text-ink tabular-nums">{kW(x.w)}</span>
              </span>
              <Bar share={(x.w ?? 0) / top} color={SOLAR} />
              <span className="text-[11.5px] text-ink-faint tabular-nums">
                {x.v != null ? `${Math.round(x.v)} V` : DASH} · {x.a != null ? `${x.a.toFixed(1)} A` : DASH}
              </span>
            </div>
          ))}
        </div>
      )}
      {!inverters.length && p?.inverter_temp != null && (
        <div className="text-xs text-ink-faint">Inverter at {Math.round(p.inverter_temp)}°C</div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- days

/** The rest of today and the next two days: solar expected, with the range it usually lands in, and the sky. */
function DaysAhead({
  f,
  acc,
  now,
}: {
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  now: number;
}) {
  const fahrenheit = useFahrenheit();
  if (!f) return null;
  const range = acc?.range;
  const top = Math.max(0.1, ...f.days.map((d) => d.pv_kwh * (range?.high ?? 1)));
  return (
    <Card>
      <TitleBlock title="Days ahead" sub="Solar the forecast expects, and the range it usually lands in" />
      <ul className="flex flex-col gap-3">
        {f.days.map((d) => {
          const today = d.date === dateKey(now);
          const lo = range ? d.pv_kwh * range.low : null;
          const hi = range ? d.pv_kwh * range.high : null;
          return (
            <li key={d.date} className="flex items-center gap-3">
              <span className="flex w-24 flex-none flex-col">
                <span className="text-[13.5px] text-ink">
                  {today ? "Rest of today" : shortDay.format(parseYmd(d.date))}
                </span>
                <span className="text-[11.5px] text-ink-faint">
                  {d.code != null ? codeName(d.code) : ""}
                  {d.temp_max != null ? ` · ${degrees(d.temp_max, fahrenheit)}` : ""}
                </span>
              </span>
              {d.code != null && <Icon name={codeIcon(d.code, true)} size={18} className="flex-none text-ink-muted" />}
              <span className="relative h-2 min-w-0 flex-1 rounded-full bg-fg/6">
                {lo != null && hi != null && (
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: `${(lo / top) * 100}%`,
                      width: `${((hi - lo) / top) * 100}%`,
                      background: alpha(SOLAR, 0.25),
                    }}
                  />
                )}
                <span
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
                  style={{ left: `${(d.pv_kwh / top) * 100}%`, background: SOLAR }}
                />
              </span>
              <span className="w-16 flex-none text-right text-[13.5px] text-ink tabular-nums">{kWh(d.pv_kwh)}</span>
            </li>
          );
        })}
      </ul>
      {range && (
        <div className="text-xs text-ink-faint">
          The shaded range is where 8 in 10 of the last {range.days} days landed against their forecast.
        </div>
      )}
    </Card>
  );
}

/** What a day made against its forecast, signed: "+1.2 kWh · +8%". */
function against(made: number, forecast: number): string {
  const d = made - forecast;
  const sign = d > 0.05 ? "+" : d < -0.05 ? "−" : "";
  return `${sign}${kWh(Math.abs(d))} · ${sign}${pct((Math.abs(d) / forecast) * 100)}`;
}

/** The last 30 days: what the panels made each day, against what the day-ahead forecast said. */
function LastDays({ acc }: { acc: ForecastAccuracy | null | undefined }) {
  const days = acc?.days ?? [];
  const { hover: h, width, plot, bar } = useBarHover();
  if (!days.length) return null;
  const top = Math.max(1, ...days.flatMap((d) => [d.actual_kwh, d.forecast_kwh])) * 1.08;
  const total = days.reduce((a, d) => a + d.actual_kwh, 0);
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TitleBlock
          title={`Last ${days.length} days`}
          sub={`${kWh(total)} in all, ${kWh(total / days.length)} a day${acc?.mae_kwh != null ? `. The forecast was out by ${kWh(acc.mae_kwh)} on an average day` : ""}`}
        />
        <div className="flex gap-4 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-xs" style={{ background: SOLAR }} />
            Made
          </span>
          <span className="flex items-center gap-1.5">
            <i className="w-3 border-t-2" style={{ borderColor: EXPECTED }} />
            Forecast
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative flex h-32 items-end gap-1 max-sm:gap-0.5" {...plot}>
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              {...bar(i)}
              aria-label={`${shortDay.format(parseYmd(d.date))}: made ${kWh(d.actual_kwh)}, forecast ${kWh(d.forecast_kwh)}`}
              className={cn(
                "relative flex h-full min-w-0 flex-1 cursor-default items-end border-0 bg-transparent p-0 transition-opacity duration-200",
                h != null && h !== i && "opacity-45",
              )}
            >
              <i
                className="bar-grow block w-full rounded-[4px_4px_2px_2px] transition-[background-color] duration-200"
                style={
                  {
                    height: `${(d.actual_kwh / top) * 100}%`,
                    background: alpha(SOLAR, h === i ? 1 : 0.75),
                    "--i": i,
                  } as CSSProperties
                }
              />
              <i
                aria-hidden
                className="absolute inset-x-0 border-t-2"
                style={{ bottom: `${(d.forecast_kwh / top) * 100}%`, borderColor: h === i ? COLOR.fg : EXPECTED }}
              />
            </button>
          ))}
          {h != null && (
            <ChartTooltip left={((h + 0.5) / days.length) * 100} flip={h > days.length / 2} width={width}>
              <span className="font-medium text-ink">{shortDay.format(parseYmd(days[h].date))}</span>
              <TooltipRow label="Made" value={kWh(days[h].actual_kwh)} color={SOLAR} />
              <TooltipRow label="Forecast" value={kWh(days[h].forecast_kwh)} color={EXPECTED} />
              {days[h].forecast_kwh > 0 && (
                <TooltipRow label="Difference" value={against(days[h].actual_kwh, days[h].forecast_kwh)} />
              )}
            </ChartTooltip>
          )}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-ink-faint">
          {[days[0], days[days.length - 1]].map((d) => (
            <span key={d.date}>{shortDay.format(parseYmd(d.date))}</span>
          ))}
        </div>
      </div>
    </Card>
  );
}
