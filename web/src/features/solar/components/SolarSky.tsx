import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useEffects } from "~/features/common/display/hooks";
import { reducedMotion } from "~/features/common/display/utils";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct, signedPct } from "~/features/common/formatting/utils/number";
import { AccountAvatar } from "~/features/auth/components/AccountAvatar";
import { InverterNotice } from "~/features/common/layout/components/InverterNotice";
import { HeaderClock } from "~/features/common/layout/components/TopBar";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { hourOf } from "~/features/common/time/utils";
import { HeroLead, HeroLive } from "~/features/common/ui/components/Hero";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { useFahrenheit } from "~/features/common/weather/hooks";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";
import { codeName, degrees, hourIcon } from "~/features/common/weather/utils";
import { SOLAR } from "~/features/solar/components/parts";
import { Pace } from "~/features/solar/components/SolarHero";
import { expectedToday, place, solarNow, solarToday } from "~/features/solar/utils";
import { atmosphere, orbits, ORBS, type Atmosphere, type Field } from "~/features/solar/utils/atmosphere";
import { moonAge, moonFace, weatherAt } from "~/features/solar/utils/sky";
import type { WeatherDay, WeatherHour } from "~/features/weather/types";

type Today = ReturnType<typeof solarToday>;

/** How long "Play the day" takes to run from midnight to midnight. */
const PLAY_MS = 20_000;
const DAY = 86_400;

/**
 * The Solar page's title and its top card. The card's top is the sky as it is now (or at any moment of today, scrubbed
 * along the chart or played through): the sun or moon where they are, the day's cloud, rain and storms coming and
 * going, the weather in one top corner and, in the other on a dark wash so it reads in any weather and either theme, a
 * line on how the day's going.
 * The sky fades into the card's solid ground. First, right under the sky, the day's solar against what was expected:
 * dragging along it moves the sky and the figures under it (so all three show while you drag), with Play the day and
 * Back to now on it. Then the figures, as on every page's top card (the Hero kit): what's been made and what's being
 * made at the moment shown, four figures that round the day out, and its pace.
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
  const skyRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root);
  const size = useSize(skyRef);
  const phone = size.w < 600;
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
  // The sky's colours change every five minutes of the day shown, not on every frame of it playing.
  const step = Math.round(view / 300) * 300;
  const sky = useMemo(
    () =>
      atmosphere((step - start) / 3600, (rise - start) / 3600, (set - start) / 3600, weatherAt(weather?.hours, step), {
        W: size.w,
        H: size.h,
        phone,
        story: line,
      }),
    [step, start, rise, set, weather?.hours, size.w, size.h, phone, line],
  );
  // Nothing more expected today: the sun's down, or the forecast has no more to come.
  const done = today.made != null && today.heading != null && today.heading - today.made < 0.05;
  const vsUsual =
    usual && (now > set ? today.made : today.heading) != null
      ? (now > set ? today.made! : today.heading!) / usual - 1
      : null;
  const playLabel = playing ? "Pause" : scrub != null && scrub >= start + DAY - 120 ? "Play again" : "Play the day";

  return (
    <>
      <InverterNotice />
      <section
        ref={root}
        aria-labelledby="h-solar"
        data-still={onScreen ? undefined : ""}
        className="sky relative isolate flex [transform:translateZ(0)] flex-col overflow-hidden rounded-[28px] border border-line-subtle bg-surface max-sm:rounded-3xl"
      >
        <div ref={skyRef} className="relative h-[280px] flex-none overflow-hidden text-white max-sm:h-[210px]">
          <SkyScene
            view={view}
            start={start}
            rise={rise}
            set={set}
            south={(at?.lat ?? -27) < 0}
            lite={lite}
            W={size.w}
            H={size.h}
            phone={phone}
            a={sky}
          />
          {/* The page's title and how the day's going, up in the sky (never over its fade into the card) on the
              sky's own wash, and the weather in the other corner (beside the title on a phone). */}
          <div className="absolute top-[26px] right-[22px] left-7 flex items-start justify-between gap-4 max-sm:top-[18px] max-sm:right-5 max-sm:left-5 max-sm:flex-wrap max-sm:items-center max-sm:gap-y-1">
            <div className="flex max-w-[600px] min-w-0 flex-col gap-0.5 max-sm:contents">
              <h1
                id="h-solar"
                className="font-display text-[40px] leading-[46px] font-semibold text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.22)] max-sm:text-[30px] max-sm:leading-9"
              >
                Solar
              </h1>
              <p
                aria-live="polite"
                className="text-base leading-[22px] font-medium text-pretty text-white/90 tabular-nums [text-shadow:0_1px_12px_rgb(0_0_0/0.22)] max-sm:order-1 max-sm:w-full"
              >
                {line}
              </p>
            </div>
            <div className="flex flex-none items-center gap-2.5">
              <div
                className="flex min-h-9 items-center gap-2 rounded-full border border-white/14 py-1.5 pr-3.5 pl-2.5 text-[13px] whitespace-nowrap tabular-nums max-sm:min-h-[34px] max-sm:gap-1.5 max-sm:pr-3 max-sm:pl-2"
                style={{ background: sky.chip }}
              >
                {hour?.code != null && (
                  <Icon name={hourIcon({ code: hour.code, is_day: hour.is_day ?? 1 })} size={phone ? 16 : 18} />
                )}
                <span>{hour?.code != null ? codeName(hour.code) : "Sky"}</span>
                {hour?.temp != null && <span className="text-zinc-200">{degrees(hour.temp, fahrenheit)}</span>}
                {/* The time shown, once it isn't now (the live clock says now). */}
                {scrub != null && <span className="text-zinc-300">· {hhmm(view)}</span>}
              </div>
              {/* From tablets up, the page's live clock and account, which sit in its top right corner elsewhere. */}
              <HeaderClock className="max-md:hidden" />
              <AccountAvatar className="max-md:hidden" />
            </div>
          </div>
        </div>

        <div className="@container relative flex flex-col gap-5 p-7 max-sm:gap-4 max-sm:p-5">
          {/* First, right under the sky, wherever the figures below it rearrange themselves (they reorder on a phone). */}
          <div className="@max-xl:-order-3">
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
          {/* The figures in as little height as reads well, so the sky, the chart and every figure show at once while
              you drag, on a phone too: there the two figures sit side by side and the four under them two by two,
              without their small print. */}
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 max-sm:grid max-sm:grid-cols-2 max-sm:items-start max-sm:gap-x-4 max-sm:gap-y-3 @max-xl:-order-2">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4 max-sm:contents">
              <HeroLead
                label={lead.label}
                value={lead.value}
                unit={lead.unit}
                sub={more ? <span className="max-sm:hidden">{more}</span> : undefined}
              />
              <HeroLive
                label={second.label}
                on={second.live}
                color={SOLAR}
                value={second.value}
                unit={second.unit}
                sub={second.sub ? <span className="max-sm:hidden">{second.sub}</span> : undefined}
              />
            </div>
            <dl className="grid grid-cols-4 gap-x-8 gap-y-3 max-sm:col-span-2 max-sm:gap-x-4 max-sm:gap-y-2 @max-2xl:grid-cols-2">
              {(
                [
                  [
                    "Peak today",
                    today.peak ? kW(today.peak.w) : DASH,
                    today.peak ? `At ${hhmm(today.peak.t)}` : "Not yet",
                  ],
                  [
                    "Best hour",
                    best ? `${hourLabel(best.h)}–${hourLabel(best.h + 1)}` : DASH,
                    best ? `${kWh(best.kwh)} in the hour` : "Not yet",
                  ],
                  [
                    "Against a usual day",
                    vsUsual != null ? (Math.abs(vsUsual) < 0.04 ? "About usual" : signedPct(vsUsual)) : DASH,
                    usual ? `Usual is ${kWh(usual)}` : "Needs a few days",
                  ],
                  [
                    "Tomorrow",
                    today.tomorrow ? kWh(today.tomorrow.pv_kwh) : DASH,
                    today.tomorrow?.code != null ? codeName(today.tomorrow.code) : "Forecast",
                  ],
                ] as const
              ).map(([label, value, sub]) => (
                <div key={label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="truncate text-xs text-ink-faint">{label}</dt>
                  <dd className="text-[20px] leading-6 font-light tracking-[-0.3px] whitespace-nowrap tabular-nums max-sm:text-[17px] max-sm:leading-[22px]">
                    {value}
                  </dd>
                  <dd className="truncate text-[11.5px] text-ink-faint max-sm:hidden">{sub}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Pace today={today} done={done} />
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

/**
 * The sky at `view` in its "Atmosphere" look (`a`, from utils/atmosphere): the base colours, the drifting colour fields, the sun
 * or moon, stars, fog, rain, a storm's flashes, grain, and the wash behind the title.
 *
 * Built to stay smooth on a phone. The colours (every gradient) only change every five minutes of sky, so while the
 * day plays they're repainted a few times a second, not on every frame; the sun and moon move every frame, but only
 * by transform. Everything that moves for good (the fields' drift, fog, rain) moves by transform or opacity alone, and
 * nothing uses blur, masks or blend modes. `lite` (a device that can't keep up) holds the fields and fog still and
 * drops the sheen.
 */
function SkyScene({
  view,
  start,
  rise,
  set,
  south,
  lite,
  W,
  H,
  phone,
  a,
}: {
  view: number;
  start: number;
  rise: number;
  set: number;
  south: boolean;
  lite: boolean;
  W: number;
  H: number;
  phone: boolean;
  a: Atmosphere;
}) {
  const o = orbits((view - start) / 3600, (rise - start) / 3600, (set - start) / 3600);
  const G = phone ? ORBS.phone : ORBS.wide;
  // An orb `size` across, centred on a point of the sky, moved only by transform.
  const orb = (x: number, y: number, size: number, scale = 1): CSSProperties => ({
    width: size,
    height: size,
    transform: `translate3d(${(x * W - size / 2).toFixed(1)}px, ${(y * H - size / 2).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
  });
  const age = moonAge(view);

  return (
    <div aria-hidden className={cn("atm pointer-events-none absolute inset-0 overflow-hidden", lite && "atm-lite")}>
      <div className="absolute inset-0" style={{ background: a.base }} />
      {[...a.aurora, ...a.fields].map((f, i) => (
        <AtmField key={i} f={f} aurora={i < a.aurora.length} />
      ))}
      {a.stars > 0.01 && <Stars opacity={a.stars} />}
      <div className="atm-orb" style={orb(o.sun.x, o.sun.y, G.bloom, a.sun.bloomScale)}>
        <div className="atm-bloom" style={{ background: a.sun.bloom }} />
      </div>
      <div className="atm-orb" style={{ ...orb(o.sun.x, o.sun.y, G.glow), background: a.sun.glow }} />
      <div
        className="atm-orb"
        style={{ ...orb(o.sun.x, o.sun.y, G.core), background: a.sun.core, opacity: a.sun.coreOpacity }}
      />
      <div
        className="atm-orb"
        style={{ ...orb(o.moon.x, o.moon.y, G.halo, a.moon.haloScale), background: a.moon.halo }}
      />
      <div className="atm-orb atm-ring" style={{ ...orb(o.moon.x, o.moon.y, G.ring), opacity: a.moon.ringOpacity }} />
      <div
        className="atm-orb rounded-full"
        style={{ ...orb(o.moon.x, o.moon.y, G.moon), opacity: a.moon.coreOpacity, ...moonFace(age, G.moon, south) }}
      />
      {a.fog.bands.length > 0 && (
        <div className="atm-fade absolute inset-0" style={{ opacity: a.fog.opacity }}>
          {a.fog.bands.map((b, i) => (
            <div
              key={i}
              className="atm-fog"
              style={{
                top: `${((b.cy - b.ry) * 100).toFixed(1)}%`,
                height: `${(b.ry * 200).toFixed(1)}%`,
                background: b.background,
                animationDuration: `${b.secs}s`,
                animationDirection: b.reverse ? "alternate-reverse" : undefined,
              }}
            />
          ))}
        </div>
      )}
      {a.rain > 0.005 && <Rain opacity={a.rain} lite={lite} />}
      {a.storm > 0 && <Flashes opacity={a.storm} />}
      <Grain />
      {/* Everything sets into the card's ground. */}
      <div className="absolute inset-x-0 bottom-0 h-[70px] bg-linear-to-b from-transparent via-surface/50 to-surface" />
      {/* The wash behind the title: the sky's own top colour, deeper, only as strong as the words need. */}
      <div className="absolute inset-0" style={{ background: a.wash }} />
    </div>
  );
}

/** One soft colour field, drifting slowly by transform (held still on a device that can't keep up). */
const AtmField = memo(function AtmField({ f, aurora }: { f: Field; aurora: boolean }) {
  return (
    <div
      className={cn("atm-field", aurora ? "atm-drift-aurora" : `atm-drift-${f.drift}`)}
      style={{
        left: `${((f.cx - f.rx) * 100).toFixed(2)}%`,
        top: `${((f.cy - f.ry) * 100).toFixed(2)}%`,
        width: `${(f.rx * 200).toFixed(2)}%`,
        height: `${(f.ry * 200).toFixed(2)}%`,
        background: f.background,
        animationDuration: `${f.secs}s`,
        animationDirection: f.reverse ? "alternate-reverse" : undefined,
      }}
    />
  );
});

/** Rain: fine streaks of light falling at a slant in two depths, each one tiled layer moved by transform, and a slow sheen. */
const Rain = memo(function Rain({ opacity, lite }: { opacity: number; lite: boolean }) {
  return (
    <div className="atm-fade absolute inset-0 overflow-hidden" style={{ opacity }}>
      {!lite && <div className="atm-sheen" />}
      <div className="atm-rain">
        <div className="atm-streaks" style={{ backgroundImage: STREAKS_FAR }} />
        {!lite && <div className="atm-streaks atm-streaks-near" style={{ backgroundImage: STREAKS_NEAR }} />}
      </div>
    </div>
  );
});

/** A tile of rain streaks as an SVG image, the same every time: `n` lines of light fading in and out down their length. */
function streakTile(seed: number, n: number, len: [number, number], alpha: [number, number]) {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const lines = Array.from({ length: n }, () => {
    const x = (r() * 240).toFixed(1);
    const y = (r() * 300).toFixed(1);
    const l = (len[0] + r() * (len[1] - len[0])).toFixed(0);
    const a = (alpha[0] + r() * (alpha[1] - alpha[0])).toFixed(2);
    return `<rect x='${x}' y='${y}' width='1' height='${l}' rx='0.5' fill='url(%23g)' opacity='${a}'/>`;
  }).join("");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='%23e2ecff' stop-opacity='0'/><stop offset='0.6' stop-color='%23e2ecff'/><stop offset='1' stop-color='%23e2ecff' stop-opacity='0'/>` +
    `</linearGradient></defs>${lines}</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}
const STREAKS_FAR = streakTile(11, 14, [40, 70], [0.25, 0.5]);
const STREAKS_NEAR = streakTile(29, 8, [70, 120], [0.35, 0.65]);

/** A storm's flashes, out of step with each other. */
const Flashes = memo(function Flashes({ opacity }: { opacity: number }) {
  return (
    <div className="atm-fade absolute inset-0" style={{ opacity }}>
      <div
        className="sky-flash"
        style={{
          background:
            "radial-gradient(ellipse 55% 60% at 64% 18%, rgba(226,232,255,0.6), rgba(190,205,255,0.14) 55%, rgba(190,205,255,0) 80%)",
        }}
      />
      <div
        className="sky-flash sky-later"
        style={{
          background:
            "radial-gradient(ellipse 45% 50% at 22% 14%, rgba(226,232,255,0.45), rgba(190,205,255,0.1) 55%, rgba(190,205,255,0) 80%)",
        }}
      />
    </div>
  );
});

/**
 * A fine film grain over the sky, which also keeps its soft gradients from banding: a small tile of noise drawn once
 * on a canvas and repeated, with no filter or blend mode.
 */
const Grain = memo(function Grain() {
  const [tile] = useState(grainTile);
  return tile ? <div className="atm-grain" style={{ backgroundImage: `url(${tile})` }} /> : null;
});
let grain: string | null | undefined;
function grainTile(): string | null {
  if (grain !== undefined) return grain;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    if (!x) return (grain = null);
    const img = x.createImageData(128, 128);
    let s = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 16807) % 2147483647;
      const v = s / 2147483647;
      const light = v > 0.5;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 0;
      img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 40);
    }
    x.putImageData(img, 0, 0);
    grain = c.toDataURL("image/png");
  } catch {
    grain = null;
  }
  return grain;
}

/** How big `ref` is (px), following it as it resizes. */
function useSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 1100, h: 300 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

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
    <div className="relative h-[210px] max-sm:h-[160px]">
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
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[38px] h-[140px] max-sm:h-[100px]">
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
      className="absolute inset-x-0 bottom-[38px] h-[140px] w-full overflow-visible max-sm:h-[100px]"
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
