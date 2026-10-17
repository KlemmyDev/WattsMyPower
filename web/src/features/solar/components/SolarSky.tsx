import { useMemo, type ReactNode } from "react";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { COLOR } from "~/features/common/theme/utils/colors";
import { hourOf } from "~/features/common/time/utils";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { codeName } from "~/features/common/weather/utils";
import { useLiveDay } from "~/features/live/hooks";
import type { LiveHero, Slim } from "~/features/live/types";
import { seriesAt, valueAt, type Pt } from "~/features/live/utils/day";
import { solarNow, solarToday } from "~/features/solar/utils";
import type { WeatherHour } from "~/features/weather/types";

type Today = ReturnType<typeof solarToday>;

const DAY = 86_400;

/**
 * Solar's part of the live pages' top card (LiveCard), with the sky and your house above it: its title, a line on how
 * the day's going, the day's solar against what was expected as the chart (dragging along it moves the sky and the
 * figures), and the figures, as on every page's top card (the Hero kit): what's been made and what's being made at the
 * moment shown, with the day's pace in a slim bar, and four figures that round the day out.
 */
export function useSolarHero({
  p,
  s,
  f,
  acc,
  series,
  usual,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  series: HistorySeries | undefined;
  /** What the panels made on an average day lately, to say how today compares. */
  usual: number | null;
}): LiveHero {
  const { now, start, weather, expected, rise, set } = useLiveDay();
  // What doesn't change as the day's scrubbed is worked out once per reading, not on every frame of it.
  const live = useMemo(() => solarNow(p, s, f, now), [p, s, f, now]);
  const today = useMemo(() => solarToday({ p, s, f, acc, series, weather, now }), [p, s, f, acc, series, weather, now]);
  const best = useMemo(() => bestHour(series, now), [series, now]);
  return useMemo(() => {
    const [line, more] = story({ today, now, rise, set, hours: weather?.hours, usual });
    // Nothing more expected today: the sun's down, or the forecast has no more to come.
    const done = today.made != null && today.heading != null && today.heading - today.made < 0.05;
    const vsUsual =
      usual && (now > set ? today.made : today.heading) != null
        ? (now > set ? today.made! : today.heading!) / usual - 1
        : null;
    const stats = [
      {
        label: "Peak today",
        value: today.peak ? kW(today.peak.w) : DASH,
        sub: today.peak ? `At ${hhmm(today.peak.t)}` : "Not yet",
      },
      {
        label: "Best hour",
        value: best ? `${hourLabel(best.h)}–${hourLabel(best.h + 1)}` : DASH,
        sub: best ? `${kWh(best.kwh)} in the hour` : "Not yet",
      },
      {
        label: "Against a usual day",
        value: vsUsual != null ? (Math.abs(vsUsual) < 0.04 ? "About usual" : signedPct(vsUsual)) : DASH,
        sub: usual ? `Usual is ${kWh(usual)}` : "Needs a few days",
      },
      {
        label: "Tomorrow",
        value: today.tomorrow ? kWh(today.tomorrow.pv_kwh) : DASH,
        sub: today.tomorrow?.code != null ? codeName(today.tomorrow.code) : "Forecast",
      },
    ];
    const slim = pace(today, done);
    return {
      page: "solar",
      title: "Solar",
      color: COLOR.solar,
      at: (view, scrubbed) => {
        const ahead = view > now + 60;
        const scrub = scrubbed ? view : null;
        // What the panels made (or were expected to) at the moment shown, and by then.
        const pvAt = ahead ? valueAt(expected, view) : seriesAt(series, "pv_power", view);
        const madeBy = ahead ? (today.made ?? 0) + expectedBetween(expected, now, view) : madeUntil(series, view);
        const lead = leadFigure({ scrub, ahead, view, today, madeBy, now, rise });
        const second = secondFigure({ scrub, ahead, view, live, today, pvAt, now, rise });
        return { story: line, more, lead, slim, second: { ...second, color: COLOR.solar }, stats };
      },
      chart: (c) => (
        <SkyChart
          series={series}
          expected={expected}
          start={start}
          now={now}
          view={c.view}
          rise={rise}
          set={set}
          array={s?.pv_kw ?? null}
          onScrub={c.onScrub}
          controls={c.controls}
        />
      ),
    };
  }, [today, now, rise, set, weather?.hours, usual, best, expected, series, live, start, s?.pv_kw]);
}

/**
 * The day's pace in the slim bar under what's been made: made so far, where it's heading by midnight (dashed), and a
 * tick for this morning's forecast.
 */
function pace(t: Today, done: boolean): Slim {
  const whole = Math.max(t.heading ?? 0, t.planned ?? 0, t.likely?.high ?? 0, t.made ?? 0, 0.1);
  const at = (v: number) => Math.min(100, (v / whole) * 100);
  const heading = t.heading != null && !done;
  return {
    label: heading
      ? `${kWh(t.made ?? 0)} so far, of about ${kWh(t.heading!)} by midnight`
      : `${kWh(t.made ?? 0)} made today`,
    fill: at(t.made ?? 0),
    color: COLOR.solar,
    ahead: heading ? at(t.heading!) : undefined,
    ticks: t.planned != null ? [{ at: at(t.planned), title: "This morning's forecast" }] : [],
  };
}

const split = (s: string) => {
  const [value, unit] = s.split(" ");
  return { value, unit: unit ?? "" };
};

/** The lead figure: made by the moment shown, made today, or what's expected before the sun's up. */
function leadFigure(x: {
  scrub: number | null;
  ahead: boolean;
  view: number;
  today: Today;
  madeBy: number;
  now: number;
  rise: number;
}) {
  if (x.scrub != null)
    return { label: `${x.ahead ? "Likely made by" : "Made by"} ${hhmm(x.view)}`, ...split(kWh(x.madeBy)) };
  if (x.now < x.rise && !x.today.made && x.today.heading != null)
    return { label: "Expected today", ...split(kWh(x.today.heading)) };
  return { label: "Made today", ...(x.today.made != null ? split(kWh(x.today.made)) : { value: DASH, unit: "" }) };
}

/** The figure beside it: what's being made at the moment shown, or when the sun's up, or tomorrow's forecast. */
function secondFigure(x: {
  scrub: number | null;
  ahead: boolean;
  view: number;
  live: ReturnType<typeof solarNow>;
  today: Today;
  pvAt: number | null;
  now: number;
  rise: number;
}) {
  if (x.scrub != null)
    return {
      label: `${x.ahead ? "Expected at" : "At"} ${hhmm(x.view)}`,
      live: false,
      sub: undefined,
      ...split(kW(x.pvAt ?? 0)),
    };
  if (x.live.producing)
    return {
      label: "Generating now",
      live: true,
      sub:
        x.live.array && x.live.share != null
          ? `${pct(x.live.share * 100)} of your ${x.live.array} kW array`
          : undefined,
      ...split(kW(x.live.pv)),
    };
  if (x.now < x.rise) return { label: "Sun up at", live: false, sub: undefined, ...split(hhmm(x.rise)) };
  return { label: "Panels resting", live: false, sub: undefined, ...split(kW(0)) };
}

/** The clock hour that's made the most so far today, from the five-minute readings, and its kWh. */
function bestHour(series: HistorySeries | undefined, now: number): { h: number; kwh: number } | null {
  const ts = series?.t ?? [];
  const v = series?.pv_power ?? [];
  const hours = new Map<number, number>();
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i] >= now) break;
    const w = v[i];
    if (w == null) continue;
    const h = hourOf(ts[i]);
    hours.set(h, (hours.get(h) ?? 0) + (w * (ts[i + 1] - ts[i])) / 3_600_000);
  }
  let best: { h: number; kwh: number } | null = null;
  for (const [h, kwh] of hours) if (kwh > 0.05 && (!best || kwh > best.kwh)) best = { h, kwh };
  return best;
}

/** The first rain or storm still to come today in daylight, as "Showers likely from 3 pm" (or nothing). */
function comingWeather(hours: WeatherHour[] | undefined, now: number, set: number): string | null {
  const next = (hours ?? []).find((h) => h.ts >= now - 1800 && h.ts < set && h.code != null && h.code >= 51);
  if (!next) {
    const rest = (hours ?? []).filter((h) => h.ts >= now && h.ts < set && h.cloud != null);
    if (!rest.length) return null;
    const cloud = rest.reduce((a, h) => a + (h.cloud ?? 0), 0) / rest.length;
    return cloud > 70 ? "Cloudy for the rest of the day." : cloud < 25 ? "Clear for the rest of the day." : null;
  }
  const what = next.code! >= 95 ? "Storms" : next.code! >= 80 ? "Showers" : "Rain";
  return next.ts <= now ? `${what} about now.` : `${what} likely from ${hhmm(next.ts)}.`;
}

/** How the day's going, in a sentence and a half: the headline, then what's coming. */
function story({
  today,
  now,
  rise,
  set,
  hours,
  usual,
}: {
  today: Today;
  now: number;
  rise: number;
  set: number;
  hours: WeatherHour[] | undefined;
  usual: number | null;
}): [string, string] {
  const coming = comingWeather(hours, now, set);
  if (now < rise)
    return [
      today.heading != null ? `About ${kWh(today.heading)} expected today.` : "The panels are resting.",
      coming ?? `The sun's up at ${hhmm(rise)}.`,
    ];
  if (now > set) {
    const vs = today.made != null && usual ? today.made / usual - 1 : null;
    return [
      today.made != null
        ? `${kWh(today.made)} today${vs != null ? (Math.abs(vs) < 0.04 ? ", about a usual day." : `, ${signedPct(vs)} on a usual day.`) : "."}`
        : "Done for the day.",
      today.tomorrow ? `Tomorrow looks like ${kWh(today.tomorrow.pv_kwh)}.` : "",
    ];
  }
  const head =
    today.heading != null
      ? `Heading for ${kWh(today.heading)}${today.pace != null && Math.abs(today.pace) >= 0.03 ? `, ${signedPct(today.pace)} on this morning's forecast.` : "."}`
      : "Making the most of the day.";
  return [head, coming ?? ""];
}

// ------------------------------------------------------------------------------------------- readings and maths

/** kWh made up to `t`: the day's five-minute readings added up. */
function madeUntil(series: HistorySeries | undefined, t: number): number {
  const ts = series?.t ?? [];
  const v = series?.pv_power ?? [];
  let wh = 0;
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i] >= t) break;
    const w = v[i];
    if (w != null) wh += (w * (Math.min(ts[i + 1], t) - ts[i])) / 3600;
  }
  return wh / 1000;
}

/** kWh an hourly line adds up to between two moments. */
function expectedBetween(pts: Pt[], from: number, to: number): number {
  let wh = 0;
  for (let t = from; t < to; t += 300) wh += ((valueAt(pts, t) ?? 0) * Math.min(300, to - t)) / 3600;
  return wh / 1000;
}

// ------------------------------------------------------------------------------------------------- the chart

// ------------------------------------------------------------------------------------------------- the chart

const W = 1000;
const H = 220;

/**
 * The day's solar against what was expected, midnight to midnight, right under the sky (which shows the weather):
 * sunrise and sunset marked. Drag along it (or use the arrow keys) to move the whole
 * scene to that moment. The lines are drawn once per reading; scrubbing only moves the marker.
 */
function SkyChart({
  series,
  expected,
  start,
  now,
  view,
  rise,
  set,
  array,
  onScrub,
  controls,
}: {
  series: HistorySeries | undefined;
  expected: Pt[];
  start: number;
  now: number;
  view: number;
  rise: number;
  set: number;
  array: number | null;
  onScrub: (t: number) => void;
  /** Play the day and the way back to now, over the chart's top left, where the night before sunrise leaves room. */
  controls: ReactNode;
}) {
  const pct = (t: number) => `${((t - start) / DAY) * 100}%`;
  const { top, exp, lines } = useMemo(() => {
    const ts = series?.t ?? [];
    const pv = series?.pv_power ?? [];
    const top =
      Math.max(1000, ...pv.map((v) => v ?? 0), ...expected.map((p) => p.v ?? 0), array ? array * 800 : 0) * 1.08;
    const exp = expected.filter((p) => p.v != null);
    return { top, exp, lines: <ChartLines ts={ts} pv={pv} exp={exp} start={start} now={now} top={top} /> };
  }, [series, expected, start, now, array]);
  const v = view > now + 60 ? valueAt(exp, view) : seriesAt(series, "pv_power", view);
  const Y = (x: number) => H - (x / top) * (H - 24);

  return (
    <div className="relative h-[134px] max-sm:h-[112px]">
      {[rise, set].map((t, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-0 bottom-[26px] border-l border-dashed"
          style={{ left: pct(t), borderColor: i ? "rgb(255 150 110 / 0.35)" : "rgb(255 190 110 / 0.35)" }}
        />
      ))}
      {lines}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[26px] h-[108px] max-sm:h-[86px]">
        <span className="absolute inset-y-0 w-px bg-ink/55" style={{ left: pct(view) }} />
        {v != null && (
          <span
            className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-solar shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-solar)_28%,transparent),0_0_16px_var(--color-solar)]"
            style={{ left: pct(view), top: `${(Y(v) / H) * 100}%` }}
          />
        )}
      </div>
      <input
        type="range"
        aria-label="Move through today"
        aria-valuetext={hhmm(view)}
        min={0}
        max={287}
        step={1}
        value={Math.min(287, Math.round((view - start) / 300))}
        onChange={(e) => onScrub(start + Number(e.target.value) * 300)}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      <div className="absolute top-0 left-0 z-2 flex items-center gap-2">{controls}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[26px] text-xs text-ink-faint tabular-nums"
      >
        <span className="absolute top-[7px] left-0 max-sm:hidden">Midnight</span>
        <span className="absolute top-[7px] -translate-x-1/2 text-solar" style={{ left: pct(rise) }}>
          Sunrise {hhmm(rise)}
        </span>
        <span className="absolute top-[7px] left-1/2 -translate-x-1/2 max-sm:hidden">Noon</span>
        <span className="absolute top-[7px] -translate-x-1/2 text-solar-deep" style={{ left: pct(set) }}>
          Sunset {hhmm(set)}
        </span>
        <span className="absolute top-[7px] right-0 max-sm:hidden">Midnight</span>
      </div>
    </div>
  );
}

/** The day's solar so far (a gold line over a fill) and what was expected (dashed, its rest of the day ghosted). */
function ChartLines({
  ts,
  pv,
  exp,
  start,
  now,
  top,
}: {
  ts: number[];
  pv: (number | null)[];
  exp: Pt[];
  start: number;
  now: number;
  top: number;
}) {
  const X = (t: number) => ((t - start) / DAY) * W;
  const Y = (v: number) => H - (v / top) * (H - 24);
  let line = "";
  let area = "";
  let open = false;
  let last = 0;
  for (let i = 0; i < ts.length; i++) {
    const v = pv[i];
    if (v == null || ts[i] > now) {
      if (open) area += ` L${X(last).toFixed(1)},${H} Z`;
      open = false;
      continue;
    }
    const p = `${X(ts[i]).toFixed(1)},${Y(v).toFixed(1)}`;
    line += `${open ? " L" : "M"}${p}`;
    area += open ? ` L${p}` : `M${X(ts[i]).toFixed(1)},${H} L${p}`;
    open = true;
    last = ts[i];
  }
  if (open) area += ` L${X(last).toFixed(1)},${H} Z`;
  const expLine = exp.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v!).toFixed(1)}`).join(" ");
  const ahead = exp.filter((p) => p.t >= now);
  const ghost = ahead.length
    ? `M${X(ahead[0].t).toFixed(1)},${H} ${ahead.map((p) => `L${X(p.t).toFixed(1)},${Y(p.v!).toFixed(1)}`).join(" ")} L${X(ahead[ahead.length - 1].t).toFixed(1)},${H} Z`
    : "";
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-[26px] h-[108px] w-full overflow-visible max-sm:h-[86px]"
    >
      <defs>
        <linearGradient id="sky-solar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-solar)" stopOpacity={0.6} />
          <stop offset="1" stopColor="var(--color-solar-deep)" stopOpacity={0.04} />
        </linearGradient>
      </defs>
      {ghost && <path d={ghost} fill="var(--color-fg)" fillOpacity={0.05} />}
      {expLine && (
        <path
          d={expLine}
          fill="none"
          stroke="var(--color-ink-faint)"
          strokeWidth={1.5}
          strokeDasharray="4 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {area && <path d={area} fill="url(#sky-solar)" />}
      {line && (
        <path d={line} fill="none" stroke="var(--color-solar)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
