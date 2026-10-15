import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useEffects } from "~/features/common/display/hooks";
import { reducedMotion } from "~/features/common/display/utils";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { hourOf } from "~/features/common/time/utils";
import { HeroFigures, HeroLead, HeroLive, HeroStat, HeroStats, HeroTop } from "~/features/common/ui/components/Hero";
import { Icon } from "~/features/common/ui/components/Icon";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { codeName, degrees, hourIcon } from "~/features/common/weather/utils";
import { SOLAR } from "~/features/solar/components/parts";
import { Pace } from "~/features/solar/components/SolarHero";
import { expectedToday, place, solarNow, solarToday } from "~/features/solar/utils";
import {
  clamp01,
  CLOUDS,
  css,
  cssA,
  DROPS,
  mix,
  moonAge,
  moonFace,
  skyColours,
  standardHour,
  weatherAt,
  type CloudBank,
  type Rgb,
} from "~/features/solar/utils/sky";
import type { WeatherDay, WeatherHour } from "~/features/weather/types";

type Today = ReturnType<typeof solarToday>;

/** How long "Play the day" takes to run from midnight to midnight. */
const PLAY_MS = 20_000;
const DAY = 86_400;
const WHITE: Rgb = [255, 255, 255];

/**
 * The Solar page's title and its top card. The card's top is the sky as it is now (or at any moment of today, scrubbed
 * along the chart or played through): the sun or moon where they are, the day's cloud, rain and storms coming and
 * going, the weather in one top corner and, in the other on a dark wash so it reads in any weather and either theme, a
 * line on how the day's going.
 * The sky fades into the card's solid ground, where the figures sit as on every page's top card (the Hero kit): what's
 * been made and what's being made at the moment shown, four figures that round the day out, its pace, and the day's
 * solar against what was expected, which moves the sky as you drag along it, with Play the day and Back to now on it.
 */
export function SolarSky({
  p,
  s,
  f,
  acc,
  series,
  weather,
  start,
  now,
  usual,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  acc: ForecastAccuracy | null | undefined;
  series: HistorySeries | undefined;
  weather: WeatherDay | undefined;
  start: number;
  now: number;
  /** What the panels made on an average day lately, to say how today compares. */
  usual: number | null;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);
  const root = useRef<HTMLElement>(null);
  const onScreen = useOnScreen(root);
  const lite = useEffects() === "lite";
  const fahrenheit = useFahrenheit();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const stop = () => {
    cancelAnimationFrame(frame.current);
    setPlaying(false);
  };
  const play = () => {
    if (playing) return stop();
    cancelAnimationFrame(frame.current);
    const from = scrub != null && scrub < start + DAY - 1800 ? scrub : start;
    let began: number | null = null;
    let shown = 0;
    setPlaying(true);
    const step = (ms: number) => {
      began ??= ms;
      // A device that can't keep up gets the day at 30 frames a second, so each one has time to be drawn.
      if (lite && ms - shown < 32) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      shown = ms;
      const t = from + ((ms - began) / PLAY_MS) * DAY;
      if (t >= start + DAY - 60) {
        setScrub(start + DAY - 60);
        setPlaying(false);
        return;
      }
      setScrub(t);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  // Back to now glides there (quicker the nearer it is) rather than jumping, unless motion's turned down.
  const backToNow = () => {
    stop();
    if (scrub == null || reducedMotion()) return setScrub(null);
    const from = scrub;
    const ms = 450 + Math.min(1, Math.abs(now - from) / (DAY / 2)) * 650;
    let began: number | null = null;
    const step = (t: number) => {
      began ??= t;
      const k = Math.min(1, (t - began) / ms);
      if (k >= 1) return setScrub(null);
      setScrub(from + (now - from) * (1 - Math.pow(1 - k, 3)));
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  // What doesn't change as the day's scrubbed is worked out once per reading, not on every frame of it.
  const live = useMemo(() => solarNow(p, s, f, now), [p, s, f, now]);
  const today = useMemo(() => solarToday({ p, s, f, acc, series, weather, now }), [p, s, f, acc, series, weather, now]);
  const expected = useMemo(() => expectedToday(weather, f, now), [weather, f, now]);
  const best = useMemo(() => bestHour(series, now), [series, now]);
  const at = place(s);
  const view = scrub ?? now;
  const ahead = view > now + 60;
  const rise = today.sun?.rise ?? start + 6 * 3600;
  const set = today.sun?.set ?? start + 18 * 3600;
  const hour = weather?.hours.find((h) => h.ts <= view && view < h.ts + 3600);

  // What the panels made (or were expected to) at the moment shown, and by then.
  const pvAt = ahead ? valueAt(expected, view) : seriesAt(series, view);
  const madeBy = ahead ? (today.made ?? 0) + expectedBetween(expected, now, view) : madeUntil(series, view);

  const lead = leadFigure({ scrub, ahead, view, today, madeBy, now, rise });
  const second = secondFigure({ scrub, ahead, view, live, today, pvAt, now, rise });
  const [line, more] = story({ today, now, rise, set, hours: weather?.hours, usual });
  // Nothing more expected today: the sun's down, or the forecast has no more to come.
  const done = today.made != null && today.heading != null && today.heading - today.made < 0.05;
  const vsUsual =
    usual && (now > set ? today.made : today.heading) != null
      ? (now > set ? today.made! : today.heading!) / usual - 1
      : null;
  const playLabel = playing ? "Pause" : scrub != null && scrub >= start + DAY - 120 ? "Play again" : "Play the day";

  return (
    <>
      <PageHeader title="Solar" sub={subLine(live, today, hour, now, rise, set)} />
      <section
        ref={root}
        aria-label="Solar now"
        data-still={onScreen ? undefined : ""}
        className="sky relative isolate flex flex-col overflow-hidden rounded-[28px] border border-line-subtle bg-surface max-sm:rounded-3xl"
      >
        <div className="relative h-[300px] flex-none overflow-hidden text-white [--cs:0.8] max-sm:h-[240px] max-sm:[--cs:0.5]">
          <SkyScene
            view={view}
            start={start}
            rise={rise}
            set={set}
            hours={weather?.hours}
            south={(at?.lat ?? -27) < 0}
            lite={lite}
          />
          <div className="sky-float absolute top-5 right-5 flex min-h-9 items-center gap-2 rounded-full border border-white/12 py-1.5 pr-3.5 pl-2.5 text-[13px] tabular-nums max-sm:top-3.5 max-sm:right-3.5">
            {hour?.code != null && (
              <Icon
                name={hourIcon({ code: hour.code, is_day: hour.is_day ?? 1 })}
                size={18}
                className="text-white/85"
              />
            )}
            <span>{hour?.code != null ? codeName(hour.code) : "Sky"}</span>
            {hour?.temp != null && <span className="text-white/80">{degrees(hour.temp, fahrenheit)}</span>}
            <span className="text-white/70">· {hhmm(view)}</span>
          </div>
          {/* Up in the sky itself, never over its fade into the card, on a soft dark wash so it reads in any weather
              (bright cloud, the sun, a storm) and in either theme. On a phone it sits under the weather. */}
          <div className="absolute top-6 left-7 max-w-[min(600px,calc(100%-300px))] max-sm:top-[68px] max-sm:right-5 max-sm:left-5 max-sm:max-w-none">
            <div aria-hidden className="absolute -inset-x-10 -inset-y-6 bg-[rgb(8_10_16/0.55)] blur-[22px]" />
            <p
              aria-live="polite"
              className="relative text-[22px] leading-7 font-semibold tracking-[-0.005em] text-pretty text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.35)] max-sm:text-lg max-sm:leading-6"
            >
              {line}
            </p>
          </div>
        </div>

        <div className="@container relative flex flex-col gap-6 p-7 max-sm:p-5">
          <HeroTop>
            <HeroFigures>
              <HeroLead label={lead.label} value={lead.value} unit={lead.unit} sub={more || undefined} />
              <HeroLive
                label={second.label}
                on={second.live}
                color={SOLAR}
                value={second.value}
                unit={second.unit}
                sub={second.sub}
              />
            </HeroFigures>
            <HeroStats>
              <HeroStat
                label="Peak today"
                value={today.peak ? kW(today.peak.w) : DASH}
                sub={today.peak ? `At ${hhmm(today.peak.t)}` : "Not yet"}
              />
              <HeroStat
                label="Best hour"
                value={best ? `${hourLabel(best.h)}–${hourLabel(best.h + 1)}` : DASH}
                sub={best ? `${kWh(best.kwh)} in the hour` : "Not yet"}
              />
              <HeroStat
                label="Against a usual day"
                value={vsUsual != null ? (Math.abs(vsUsual) < 0.04 ? "About usual" : signedPct(vsUsual)) : DASH}
                sub={usual ? `Usual is ${kWh(usual)}` : "Needs a few days"}
              />
              <HeroStat
                label="Tomorrow"
                value={today.tomorrow ? kWh(today.tomorrow.pv_kwh) : DASH}
                sub={today.tomorrow?.code != null ? codeName(today.tomorrow.code) : "Forecast"}
              />
            </HeroStats>
          </HeroTop>
          <Pace today={today} done={done} />
          <SkyChart
            series={series}
            expected={expected}
            hours={weather?.hours}
            start={start}
            now={now}
            view={view}
            rise={rise}
            set={set}
            array={s?.pv_kw ?? null}
            onScrub={(t) => {
              stop();
              setScrub(t);
            }}
            controls={
              <>
                <button
                  type="button"
                  onClick={play}
                  aria-label={playLabel}
                  className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface pr-3.5 pl-3 text-[13px] text-ink shadow-sm transition-colors hover:bg-surface-raised max-sm:size-9 max-sm:justify-center max-sm:p-0"
                >
                  <Icon name={playing ? "pause" : "play"} size={13} className="text-solar" />
                  <span className="max-sm:hidden">{playLabel}</span>
                </button>
                {scrub != null && (
                  <button
                    type="button"
                    onClick={backToNow}
                    className="min-h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] whitespace-nowrap text-ink tabular-nums shadow-sm transition-colors hover:bg-surface-raised max-sm:px-3"
                  >
                    <span className="max-sm:hidden">Back to now · </span>
                    <span className="sm:hidden">Now · </span>
                    {hhmm(now)}
                  </button>
                )}
              </>
            }
          />
        </div>
      </section>
    </>
  );
}

/** Whether `ref` is on screen, so what moves in it can stop while it's scrolled away. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

// ------------------------------------------------------------------------------------------------- the figures

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

/** The line under the page's title: what's happening, numbers first. */
function subLine(
  live: ReturnType<typeof solarNow>,
  today: Today,
  hour: WeatherHour | undefined,
  now: number,
  rise: number,
  set: number,
) {
  const sky = hour?.code != null ? codeName(hour.code).toLowerCase() : null;
  if (live.producing) return [`${kW(live.pv)} now`, sky].filter(Boolean).join(" · ");
  if (now > set && today.made != null) return `${kWh(today.made)} today · done for the day`;
  if (now < rise) return `Sun's up at ${hhmm(rise)}`;
  return "Panels resting";
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

/** The reading nearest `t` in a day's series (W), or null. */
function seriesAt(series: HistorySeries | undefined, t: number): number | null {
  const ts = series?.t ?? [];
  const v = series?.pv_power ?? [];
  let best: number | null = null;
  let gap = Infinity;
  for (let i = 0; i < ts.length; i++) {
    const d = Math.abs(ts[i] - t);
    if (d < gap && v[i] != null) {
      gap = d;
      best = v[i]!;
    }
  }
  return gap <= 900 ? best : null;
}

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

type Pt = { t: number; v: number | null };

/** What an hourly line says at `t` (W), between its points. */
function valueAt(pts: Pt[], t: number): number | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.t && t <= b.t && a.v != null && b.v != null) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return null;
}

/** kWh an hourly line adds up to between two moments. */
function expectedBetween(pts: Pt[], from: number, to: number): number {
  let wh = 0;
  for (let t = from; t < to; t += 300) wh += ((valueAt(pts, t) ?? 0) * Math.min(300, to - t)) / 3600;
  return wh / 1000;
}

// ------------------------------------------------------------------------------------------------- the scene

/** Clouds on a device that can't keep up: every other bank, still spread through every amount of cover. */
const LITE_CLOUDS = CLOUDS.filter((_, i) => i % 2 === 0);

/**
 * The sky at `view`: its colours for the time of day, stars, the sun and moon on their arcs (setting into the card's
 * ground rather than vanishing), cloud banks drifting across at their own speeds, an overcast layer, rain, and
 * lightning in a storm. Everything follows the weather eased between hours, so it comes and goes smoothly.
 *
 * It's drawn to be cheap to keep moving: only the cloud, rain and lightning the weather calls for are there at all,
 * each cloud is painted once and then only moved, and the clouds' colours follow the light by the quarter hour, so
 * while the day plays they're repainted a few times a second rather than on every frame. `lite` draws less again.
 */
function SkyScene({
  view,
  start,
  rise,
  set,
  hours,
  south,
  lite,
}: {
  view: number;
  start: number;
  rise: number;
  set: number;
  hours: WeatherHour[] | undefined;
  south: boolean;
  lite: boolean;
}) {
  const h = (view - start) / 3600;
  const riseH = (rise - start) / 3600;
  const setH = (set - start) / 3600;
  const w = weatherAt(hours, view);
  const [top, mid, low] = skyColours(standardHour(h, riseH, setH), w);

  // The sun across the day; the moon across the night, from sunset to the next sunrise.
  const xs = (h - riseH) / (setH - riseH);
  const es = Math.sin(Math.PI * xs);
  const night = 24 - (setH - riseH);
  const xm = h >= setH ? (h - setH) / night : h < riseH ? (h + 24 - setH) / night : -1;
  const em = xm >= 0 && xm <= 1 ? Math.sin(Math.PI * xm) : -0.5;
  const day = clamp01(es * 4 + 0.35);

  const quarter = Math.round(view / 900) * 900;
  const tone = useMemo(() => cloudTone(quarter, start, riseH, setH, hours), [quarter, start, riseH, setH, hours]);

  const arc = (x: number, e: number): CSSProperties => ({ left: `${6 + x * 88}%`, top: `${100 - e * 82}%` });
  const sunCol = css(mix([255, 247, 226], [255, 156, 90], clamp01(1 - es * 3)));
  const age = moonAge(view);
  const stars = (1 - day) * (1 - w.cover) * 0.9;
  const storm = clamp01((w.storm - 0.2) / 0.6);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-1">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${css(top)} 0%, ${css(mid)} 50%, ${css(low)} 80%, var(--color-surface) 100%)`,
        }}
      />
      {stars > 0.01 && <Stars opacity={stars} />}
      <div className="absolute inset-0 overflow-hidden">
        <span
          className="absolute size-[420px] rounded-full max-sm:size-[300px]"
          style={{
            ...arc(xs, es),
            opacity: clamp01(es * 3 + 0.4) * (0.95 - 0.45 * w.cover),
            transform: `translate(-50%, -50%) scale(${1 + w.cover * 0.5})`,
            background: `radial-gradient(closest-side, rgba(255,232,180,${0.7 - 0.3 * w.cover}), rgba(255,180,90,0.2) 38%, rgba(255,150,60,0) 72%)`,
          }}
        />
        <span
          className="absolute size-14 -translate-x-1/2 -translate-y-1/2 rounded-full max-sm:size-11"
          style={{
            ...arc(xs, es),
            opacity: es > -0.2 ? 1 - 0.9 * w.cover : 0,
            background: `radial-gradient(circle, ${sunCol} 0 56%, rgba(255,226,170,0.55) 72%, rgba(255,214,150,0) 100%)`,
            boxShadow: `0 0 40px 12px rgba(255,214,150,${0.5 - 0.35 * w.cover})`,
          }}
        />
        <span
          className="absolute size-[280px] rounded-full max-sm:size-[210px]"
          style={{
            ...arc(xm, em),
            opacity: clamp01(em * 3 + 0.3) * (1 - day) * (0.9 - 0.5 * w.cover),
            transform: `translate(-50%, -50%) scale(${1 + w.cover * 0.6})`,
            background:
              "radial-gradient(closest-side, rgba(214,224,255,0.3), rgba(180,196,240,0.08) 45%, rgba(180,196,240,0) 72%)",
          }}
        />
        <span
          className="absolute size-11 -translate-x-1/2 -translate-y-1/2 rounded-full max-sm:size-9"
          style={{ ...arc(xm, em), opacity: (1 - day) * (1 - 0.85 * w.cover), ...moonFace(age, 44, south) }}
        />
      </div>
      <div
        className="sky-fade absolute inset-0"
        style={{
          opacity: Math.pow(w.cover, 1.6) * 0.95,
          background: `linear-gradient(180deg, ${tone.shade} 0%, ${tone.haze} 42%, ${tone.clear} 85%)`,
        }}
      />
      {(lite ? LITE_CLOUDS : CLOUDS).map((c) => {
        const o =
          c.layer === "scud"
            ? clamp01((w.rain - 0.3) / 0.3) * clamp01(w.cover * 2 - 1)
            : clamp01((w.cover - c.from) / 0.18);
        const i = CLOUDS.indexOf(c);
        return o > 0.005 && <Cloud key={i} i={i} c={c} o={o} tone={tone.layers[c.layer]} lite={lite} />;
      })}
      <div
        className="sky-fade absolute inset-0"
        style={{
          opacity: w.rain * 0.65,
          background: `linear-gradient(180deg, ${tone.wet0} 15%, ${tone.wet1} 70%, ${tone.wet2} 100%)`,
        }}
      />
      {w.rain > 0 && (
        <div className="absolute -inset-x-[15%] -top-[12%] bottom-0 rotate-[11deg]">
          {DROPS.map((d, i) => {
            const o = clamp01((w.rain - d.from) / 0.12) * (d.near ? 0.8 : 0.45);
            if (o <= 0 || (lite && i % 3)) return null;
            return (
              <span
                key={i}
                className="sky-drop"
                style={{
                  left: `${d.x}%`,
                  width: d.near ? 1.6 : 1,
                  height: d.len,
                  animationDuration: `${d.secs}s`,
                  animationDelay: `${d.delay}s`,
                  opacity: o,
                }}
              />
            );
          })}
        </div>
      )}
      {storm > 0 && <Lightning opacity={storm} />}
      {/* Everything sets into the card's ground: the sun and moon, the clouds, the rain. */}
      <div className="absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent via-surface/60 to-surface" />
    </div>
  );
}

type CloudColours = { hi: string; mid: string; bot: string; glow: string; rim: string; base: string };
type Tone = {
  layers: Record<CloudBank["layer"], CloudColours & { dx: string }>;
  shade: string;
  haze: string;
  clear: string;
  wet0: string;
  wet1: string;
  wet2: string;
};

/**
 * The clouds' light at a moment: white tops by day, warm at golden hour, moonlit blue-grey at night, slate in a storm,
 * lit toward the sun's (or the moon's) side, with a bright rim where the light catches their edges (warm low in the sky,
 * silver by moonlight, all but gone in a storm) and a darker belly. As strings, so a cloud whose light hasn't changed
 * isn't drawn again.
 */
function cloudTone(t: number, start: number, riseH: number, setH: number, hours: WeatherHour[] | undefined): Tone {
  const h = (t - start) / 3600;
  const w = weatherAt(hours, t);
  const [, mid, low] = skyColours(standardHour(h, riseH, setH), w);
  const xs = (h - riseH) / (setH - riseH);
  const night = 24 - (setH - riseH);
  const xm = h >= setH ? (h - setH) / night : h < riseH ? (h + 24 - setH) / night : -1;
  const es = Math.sin(Math.PI * xs);
  const day = clamp01(es * 4 + 0.35);
  // The rim: sunlight, warmer the lower the sun, or the moon's silver; dulled by a storm.
  const rimCol = mix([196, 208, 236], mix(WHITE, [255, 200, 140], clamp01(1 - es * 2.2)), day);
  const rimA = (0.32 + 0.6 * day) * (1 - 0.75 * w.storm);

  let light = mix(mix([75, 85, 107], mid, 0.3), mix(WHITE, low, 0.22), day);
  let shade = mix(light, [43, 49, 61], 0.5);
  light = mix(light, [59, 65, 76], w.storm * 0.55);
  shade = mix(shade, [29, 33, 40], w.storm * 0.6);
  const dx = `${((clamp01(day > 0.5 ? xs : xm) - 0.5) * 24).toFixed(1)}px`;

  const layer = (l: CloudBank["layer"]) => {
    let top = light;
    let bot: Rgb;
    if (l === "far") {
      top = mix(light, mid, 0.35);
      bot = mix(shade, mid, 0.35);
    } else if (l === "scud") {
      top = mix(shade, light, 0.3);
      bot = mix(shade, [18, 20, 26], 0.45);
    } else bot = mix(shade, low, 0.25 * day * (1 - w.storm));
    const hi = mix(
      top,
      WHITE,
      (l === "scud" ? 0.08 : l === "far" ? 0.18 : 0.32) * (0.35 + 0.65 * day) * (1 - 0.4 * w.storm),
    );
    return {
      hi: css(hi),
      mid: css(l === "near" ? mix(top, bot, 0.18) : top),
      bot: css(bot),
      glow: cssA(top, 0.5),
      rim: cssA(rimCol, rimA * (l === "far" ? 0.55 : l === "scud" ? 0.25 : 1)),
      base: cssA(mix(bot, [10, 12, 18], 0.35), (l === "far" ? 0.12 : l === "scud" ? 0.45 : 0.34) + 0.2 * w.storm),
      dx,
    };
  };
  return {
    layers: { far: layer("far"), near: layer("near"), scud: layer("scud") },
    shade: css(shade),
    haze: cssA(light, 0.6),
    clear: cssA(light, 0),
    wet0: cssA(shade, 0),
    wet1: cssA(shade, 0.5),
    wet2: cssA(shade, 0.15),
  };
}

/** One clock for every cloud, so one that's only just come out is where it would have been all along. */
const cloudClock = () => performance.now() / 1000;

/**
 * A cloud bank crossing at its own pace (the far ones slowest), puffs lit on top toward the sun or moon and shaded
 * under. Only its opacity changes as the weather comes and goes, which moves nothing that has to be painted again.
 */
const Cloud = memo(
  function Cloud({
    i,
    c,
    o,
    tone,
    lite,
  }: {
    i: number;
    c: CloudBank;
    o: number;
    tone: CloudColours & { dx: string };
    lite: boolean;
  }) {
    const [delay] = useState(() => -((cloudClock() + c.secs * c.start) % c.secs));
    const vars = {
      "--hi": tone.hi,
      "--mid": tone.mid,
      "--bot": tone.bot,
      "--rim": tone.rim,
      "--base": tone.base,
      "--dx": tone.dx,
    } as CSSProperties;
    return (
      <div
        className="sky-lane"
        style={
          {
            left: `calc(-330px * ${c.scale} * var(--cs))`,
            top: `${c.top}%`,
            opacity: o * (c.layer === "far" ? 0.8 : c.layer === "scud" ? 0.9 : 0.97),
            "--secs": `${c.secs}s`,
            "--delay": `${delay.toFixed(1)}s`,
            "--bob": `${9 + (i % 5) * 1.7}s`,
            "--bob-delay": `-${(i * 1.3).toFixed(1)}s`,
            "--start": `${c.start * 100}%`,
          } as CSSProperties
        }
      >
        <div
          className="absolute top-0 left-0 h-[120px] w-[300px] origin-top-left"
          style={{
            transform: `scale(calc(${c.scale} * var(--cs)))`,
            filter: lite ? undefined : `blur(${c.layer === "far" ? 2.2 : c.layer === "scud" ? 1.8 : 0.8}px)`,
          }}
        >
          {!lite && <div className={`sky-puff sky-puff-soft sky-cloud-${c.shape}`} style={{ background: tone.glow }} />}
          <div className={`sky-puff sky-vol sky-cloud-${c.shape}`} style={vars} />
        </div>
      </div>
    );
  },
  // The same light in a new object (the next quarter hour, unchanged at midday) isn't a reason to paint it again.
  (a, b) =>
    a.o === b.o &&
    a.lite === b.lite &&
    a.c === b.c &&
    a.tone.hi === b.tone.hi &&
    a.tone.mid === b.tone.mid &&
    a.tone.bot === b.tone.bot &&
    a.tone.glow === b.tone.glow &&
    a.tone.rim === b.tone.rim &&
    a.tone.base === b.tone.base &&
    a.tone.dx === b.tone.dx,
);

/** Two layers of stars twinkling out of step, faded by daylight and cloud. */
const Stars = memo(function Stars({ opacity }: { opacity: number }) {
  return (
    <div className="sky-fade absolute inset-0" style={{ opacity }}>
      <div className="sky-twinkle" style={{ backgroundImage: STARS_A }} />
      <div className="sky-twinkle" style={{ animationDelay: "-1.8s", backgroundImage: STARS_B }} />
    </div>
  );
});
const dots = (pts: [number, number, number][]) =>
  pts.map(([x, y, r]) => `radial-gradient(${r}px ${r}px at ${x}% ${y}%, #fff, transparent)`).join(", ");
const STARS_A = dots([
  [8, 14, 1],
  [31, 9, 1.5],
  [58, 7, 1],
  [81, 13, 1],
  [13, 47, 1],
  [66, 41, 1],
  [37, 52, 1],
]);
const STARS_B = dots([
  [19, 32, 1],
  [44, 24, 1],
  [69, 29, 1.5],
  [92, 35, 1],
  [52, 42, 1],
  [76, 49, 1],
  [25, 6, 1],
  [88, 21, 1],
]);

/** A storm's flashes and bolts, out of step with each other. */
const Lightning = memo(function Lightning({ opacity }: { opacity: number }) {
  return (
    <div className="sky-fade absolute inset-0" style={{ opacity }}>
      <div
        className="sky-flash"
        style={{
          background:
            "radial-gradient(ellipse 55% 60% at 64% 18%, rgba(226,232,255,0.7), rgba(190,205,255,0.16) 55%, rgba(190,205,255,0) 80%)",
        }}
      />
      <div
        className="sky-flash sky-later"
        style={{
          background:
            "radial-gradient(ellipse 45% 50% at 22% 14%, rgba(226,232,255,0.55), rgba(190,205,255,0.12) 55%, rgba(190,205,255,0) 80%)",
        }}
      />
      <svg className="sky-bolt left-[62%] h-[240px] w-24 max-sm:h-[180px] max-sm:w-[72px]" viewBox="0 0 120 300">
        <path
          d="M70 0 58 70l14 4-26 76 14 4-26 86M58 70 40 104M46 150l-16 28"
          fill="none"
          stroke="#f4f6ff"
          strokeWidth={2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <svg
        className="sky-bolt sky-later left-[30%] h-[180px] w-[72px] max-sm:h-[130px] max-sm:w-[52px]"
        viewBox="0 0 120 300"
      >
        <path
          d="M50 0 62 60l-14 6 22 74-14 6 18 74M62 60l18 32"
          fill="none"
          stroke="#f4f6ff"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
});

// ------------------------------------------------------------------------------------------------- the chart

const W = 1000;
const H = 220;

/**
 * The day's solar against what was expected, midnight to midnight, at the foot of the card: the hour's weather above
 * it every three hours, sunrise and sunset marked. Drag along it (or use the arrow keys) to move the whole
 * scene to that moment. The lines are drawn once per reading; scrubbing only moves the marker.
 */
function SkyChart({
  series,
  expected,
  hours,
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
  hours: WeatherHour[] | undefined;
  start: number;
  now: number;
  view: number;
  rise: number;
  set: number;
  array: number | null;
  onScrub: (t: number | null) => void;
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
  const icons = useMemo(
    () =>
      [1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5].map((hh) => {
        const t = start + hh * 3600;
        const hr = hours?.find((x) => x.ts <= t && t < x.ts + 3600);
        return { t, icon: hr?.code != null ? hourIcon({ code: hr.code, is_day: hr.is_day ?? 0 }) : null };
      }),
    [hours, start],
  );
  const v = view > now + 60 ? valueAt(exp, view) : seriesAt(series, view);
  const Y = (x: number) => H - (x / top) * (H - 24);

  return (
    <div className="relative h-[230px] max-sm:h-[190px]">
      {icons.map(
        (x) =>
          x.icon && (
            <span
              key={x.t}
              aria-hidden
              className="sky-fade absolute top-1 -translate-x-1/2 text-ink-muted"
              style={{ left: pct(x.t), opacity: Math.abs(view - x.t) <= 5400 ? 1 : 0.45 }}
            >
              <Icon name={x.icon} size={18} />
            </span>
          ),
      )}
      {[rise, set].map((t, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-8 bottom-[38px] border-l border-dashed"
          style={{ left: pct(t), borderColor: i ? "rgb(255 150 110 / 0.35)" : "rgb(255 190 110 / 0.35)" }}
        />
      ))}
      {lines}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[38px] h-[160px] max-sm:h-[120px]">
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
      <div className="absolute top-8 left-0 z-2 flex items-center gap-2">{controls}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[38px] text-xs text-ink-faint tabular-nums"
      >
        <span className="absolute top-[11px] left-0 max-sm:hidden">Midnight</span>
        <span className="absolute top-[11px] -translate-x-1/2 text-solar" style={{ left: pct(rise) }}>
          Sunrise {hhmm(rise)}
        </span>
        <span className="absolute top-[11px] left-1/2 -translate-x-1/2 max-sm:hidden">Noon</span>
        <span className="absolute top-[11px] -translate-x-1/2 text-solar-deep" style={{ left: pct(set) }}>
          Sunset {hhmm(set)}
        </span>
        <span className="absolute top-[11px] right-0 max-sm:hidden">Midnight</span>
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
      className="absolute inset-x-0 bottom-[38px] h-[160px] w-full overflow-visible max-sm:h-[120px]"
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
