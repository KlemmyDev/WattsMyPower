import { useEffect, useMemo, useRef, useState } from "react";
import { AccountAvatar } from "~/features/auth/components/AccountAvatar";
import { useBatteryView } from "~/features/battery/hooks";
import { levelOn } from "~/features/battery/utils/today";
import { useEffects } from "~/features/common/display/hooks";
import { reducedMotion } from "~/features/common/display/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { HeaderClock } from "~/features/common/layout/components/TopBar";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { LiveDot } from "~/features/common/ui/components/Live";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { codeName, degrees, hourIcon } from "~/features/common/weather/utils";
import { LiveHouse } from "~/features/live/components/LiveHouse";
import { SkyScene, useOnScreen, useSize } from "~/features/live/components/LiveSky";
import { CrossFade, Swap } from "~/features/live/components/Swap";
import type { ChartProps, LiveDay, LiveHero, Slim } from "~/features/live/types";
import { lightAt, seriesAt, valueAt } from "~/features/live/utils/day";
import { houseOptions } from "~/features/overview/utils/house/options";
import { place } from "~/features/solar/utils";
import { atmosphere } from "~/features/solar/utils/atmosphere";
import { weatherAt } from "~/features/solar/utils/sky";

/** How long "Play the day" takes to run from midnight to midnight. */
const PLAY_MS = 20_000;
const DAY = 86_400;

/**
 * The live pages' top card, which stays put as you move between them (their layout owns it). Its top is the sky as it
 * is now, or at any moment of today scrubbed along the chart or played through: the sun or moon where they are, the
 * day's weather, and your house along the bottom, seen from the page's camera spot (Solar's panels, Battery's battery),
 * which flies to the next page's spot when you change page. Over the sky, the page's title and a line on how it's
 * going, and the weather. The sky fades into the card's solid ground: first the page's chart, which scrubs the day
 * (Play the day and Back to now on it), then the page's figures in one band.
 *
 * Changing page, the card doesn't move: the title and story cross-fade, the figures count to their new values, and the
 * chart draws in again. The moment shown (scrubbed or now) carries over from page to page.
 */
export function LiveCard({ hero, day }: { hero: LiveHero; day: LiveDay }) {
  const { now, start, rise, set } = day;
  const p = useSnapshot();
  const s = useSystem();
  const outlook = useBatteryView()?.outlook ?? null;
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

  const view = scrub ?? now;
  const scrubbed = scrub != null;
  const ahead = view > now + 60;
  const m = useMemo(() => hero.at(view, scrubbed), [hero, view, scrubbed]);
  const hour = day.weather?.hours.find((h) => h.ts <= view && view < h.ts + 3600);

  // The sky's colours and the sun's light change every five minutes of the day shown, not on every frame of it playing.
  const step = Math.round(view / 300) * 300;
  const storyText = phone || !m.more ? m.story : `${m.story} ${m.more}`;
  const weather = useMemo(() => weatherAt(day.weather?.hours, step), [day.weather?.hours, step]);
  const sky = useMemo(
    () =>
      atmosphere((step - start) / 3600, (rise - start) / 3600, (set - start) / 3600, weather, {
        W: size.w,
        H: size.h,
        phone,
        story: storyText,
      }),
    [step, start, rise, set, weather, size.w, size.h, phone, storyText],
  );
  const at = place(s);
  const lat = at?.lat;
  const lon = at?.lon;
  const light = useMemo(
    () => lightAt(step, lat != null && lon != null ? { lat, lon } : null, weather, sky.light),
    [step, lat, lon, weather, sky.light],
  );

  // What the house shows at the moment shown: how hard the panels are working, and the battery.
  const pv = !scrubbed
    ? (p?.pv_power ?? 0)
    : ahead
      ? (valueAt(day.expected, view) ?? 0)
      : (seriesAt(day.series, "pv_power", view) ?? 0);
  const arrayW = (s?.pv_kw ?? 0) * 1000 || 5000;
  const cap = s?.battery_kwh ?? 0;
  const batteryW = !scrubbed
    ? (p?.battery_power ?? null)
    : ahead
      ? outlookPower(outlook?.points, view, cap)
      : seriesAt(day.series, "battery_power", view);
  const level = !scrubbed
    ? (p?.battery_soc ?? null)
    : ahead
      ? levelOn(outlook?.points ?? [], view)
      : seriesAt(day.series, "battery_soc", view);
  const share = Math.round((pv / arrayW) * 200) / 200;
  const on = pv > 50;
  const house = useMemo(() => houseOptions(s), [s]);
  const state = useMemo(
    () => ({ light: sky.light, share, on, battery: { w: batteryW, level } }),
    [sky.light, share, on, batteryW, level],
  );

  const playLabel = playing ? "Pause" : scrub != null && scrub >= start + DAY - 120 ? "Play again" : "Play the day";
  const controls = (
    <>
      <button
        type="button"
        onClick={play}
        aria-label={playLabel}
        className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface pr-3.5 pl-3 text-[13px] text-ink shadow-sm transition-colors hover:bg-surface-raised max-sm:size-9 max-sm:justify-center max-sm:p-0"
      >
        <Icon
          name={playing ? "pause" : "play"}
          size={13}
          className="transition-colors duration-500"
          style={{ color: hero.color }}
        />
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
  );
  const { page } = hero;

  return (
    <section
      ref={root}
      aria-labelledby="h-live"
      data-still={onScreen ? undefined : ""}
      className="sky relative isolate flex [transform:translateZ(0)] flex-col overflow-hidden rounded-[28px] border border-line-subtle bg-surface max-sm:rounded-3xl"
    >
      <div ref={skyRef} className="relative h-[480px] flex-none overflow-hidden text-white max-sm:h-[330px]">
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
          roof={<LiveHouse house={house} spot={page} phone={phone} light={light} state={state} lite={lite} />}
        />
        {/* The page's title and how it's going, up in the sky (never over its fade into the card) on the sky's own
            wash, and the weather in the other corner (beside the title on a phone). */}
        <div className="absolute top-[26px] right-[22px] left-7 flex items-start justify-between gap-4 max-sm:top-[18px] max-sm:right-5 max-sm:left-5 max-sm:flex-wrap max-sm:items-center max-sm:gap-y-1">
          <div className="flex max-w-[600px] min-w-0 flex-col gap-0.5 max-sm:contents">
            <CrossFade
              k={page}
              text={hero.title}
              render={(t, current) => (
                <h1
                  id={current ? "h-live" : undefined}
                  className="font-display text-[40px] leading-[46px] font-semibold text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.22)] max-sm:text-[30px] max-sm:leading-9"
                >
                  {t}
                </h1>
              )}
            />
            <CrossFade
              k={page}
              text={`${m.story}\u0000${m.more ?? ""}`}
              className="max-sm:order-1 max-sm:w-full"
              render={(t, current) => {
                const [line, more] = t.split("\u0000");
                return (
                  <p
                    aria-live={current && !scrubbed ? "polite" : undefined}
                    className="text-base leading-[22px] font-medium text-pretty text-white/90 tabular-nums [text-shadow:0_1px_12px_rgb(0_0_0/0.22)]"
                  >
                    {line}
                    {more && <span className="max-sm:hidden"> {more}</span>}
                  </p>
                );
              }}
            />
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

      <div className="relative flex flex-col gap-4 px-7 pt-3 pb-6 max-sm:gap-3 max-sm:px-5 max-sm:pt-2 max-sm:pb-5">
        {/* First, right under the sky, the page's chart: dragging it moves the sky and the figures. */}
        <div key={page} className="live-draw">
          <Chart
            hero={hero}
            view={view}
            scrubbed={scrubbed}
            onScrub={(t) => {
              stop();
              setScrub(t);
            }}
            controls={controls}
          />
        </div>
        {/* The figures in one band under the chart: the page's lead figure (a slim bar under it) and what's happening
            at the moment shown, then four that round it out. Narrower, the two sit side by side over the four; on a
            phone the four go two by two without their small print. */}
        <div className="flex items-end gap-x-8 gap-y-3 max-lg:grid max-lg:grid-cols-2 max-lg:items-start max-lg:gap-x-4">
          <div className="flex min-w-0 flex-col gap-1 lg:min-w-[190px]">
            <span className="text-xs text-ink-muted">
              <Swap text={m.lead.label} page={page} />
            </span>
            <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
              <Swap
                text={m.lead.value}
                page={page}
                className="text-[44px] leading-11 tracking-[-1.5px] max-sm:text-[36px] max-sm:leading-9"
              />
              <Swap text={m.lead.unit ?? ""} page={page} className="text-base text-ink-faint" />
            </span>
            <SlimBar slim={m.slim} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 self-start border-l border-line-subtle pl-6 max-lg:border-l-0 max-lg:pl-0 lg:self-end">
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              <LiveDot on={m.second.live} color={m.second.color} />
              <Swap text={m.second.label} page={page} />
            </span>
            <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
              <Swap text={m.second.value} page={page} className="text-[28px] leading-8 tracking-[-0.8px]" />
              <Swap text={m.second.unit ?? ""} page={page} className="text-sm font-normal text-ink-faint" />
            </span>
            <span className="truncate text-[11.5px] text-ink-faint max-sm:hidden">
              <Swap text={m.second.sub ?? ""} page={page} />
            </span>
          </div>
          <dl className="ml-auto grid max-w-[600px] flex-1 grid-cols-4 gap-x-6 max-lg:col-span-2 max-lg:ml-0 max-lg:max-w-none max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-2">
            {m.stats.map((st, i) => (
              <div key={i} className="flex min-w-0 flex-col gap-0.5">
                <dt className="truncate text-xs text-ink-faint">
                  <Swap text={st.label} page={page} />
                </dt>
                <dd className="text-lg leading-6 font-light tracking-[-0.3px] whitespace-nowrap tabular-nums max-sm:text-base max-sm:leading-5">
                  <Swap text={st.value} page={page} />
                </dd>
                <dd className="truncate text-[11.5px] text-ink-faint max-sm:hidden">
                  <Swap text={st.sub ?? ""} page={page} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** The page's chart. */
function Chart({ hero, ...props }: ChartProps & { hero: LiveHero }) {
  return hero.chart(props);
}

const pc = (x: number) => `${Math.max(0, Math.min(100, x)).toFixed(2)}%`;

/**
 * The slim bar under the lead figure, shared by the live pages so it slides from one page's to the next: filled so
 * far, dashed on to where it's heading, the reserve hatched in, and ticks for what it's measured against. Its words
 * are its label, so it reads aloud and on hover.
 */
function SlimBar({ slim }: { slim: Slim }) {
  return (
    <div
      role="img"
      aria-label={slim.label}
      title={slim.label}
      className="relative mt-1.5 h-1.5 w-full min-w-40 rounded-full bg-track"
    >
      <span
        className="live-slim absolute inset-y-0 left-0 rounded-full border border-dashed"
        style={{ width: pc(slim.ahead ?? 0), borderColor: alpha(slim.color, 0.7), opacity: slim.ahead != null ? 1 : 0 }}
      />
      <span
        className="live-slim absolute inset-y-0 left-0 rounded-full"
        style={{ width: pc(slim.fill), background: slim.color }}
      />
      <span
        aria-hidden
        className="live-slim absolute inset-y-0 left-0 rounded-l-full"
        style={{
          width: pc(slim.reserve ?? 0),
          opacity: slim.reserve ? 1 : 0,
          background: `repeating-linear-gradient(135deg, ${alpha(COLOR.fg, 0.16)} 0 3px, transparent 3px 6px)`,
        }}
      />
      {[0, 1, 2].map((i) => {
        const t = slim.ticks[i];
        return (
          <span
            key={i}
            title={t?.title}
            className="live-slim absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full"
            style={{ left: pc(t?.at ?? 0), background: t?.color ?? COLOR.ink, opacity: t ? 1 : 0 }}
          />
        );
      })}
    </div>
  );
}

/** What the battery's expected to be doing at `t` (W, charging negative), from how its expected level moves then. */
function outlookPower(points: [number, number][] | undefined, t: number, cap: number): number | null {
  const a = levelOn(points ?? [], t);
  const b = levelOn(points ?? [], t + 900);
  if (a == null || b == null || !cap) return null;
  return -(((b - a) / 100) * cap * 4 * 1000);
}
