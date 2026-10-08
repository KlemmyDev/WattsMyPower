import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { carsQuery } from "~/features/car/api";
import { carName, paintOf } from "~/features/car/utils";
import { homeQuery } from "~/features/home/api";
import { deviceColors, liveBreakdown, OTHER_COLOR, type LivePart } from "~/features/home/utils";
import { forecastQuery } from "~/features/common/weather/api";
import type { Forecast, ForecastHour, WeatherTiming } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import { clock, duration, hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { batteryState, batteryTone, gridVerb, ON } from "~/features/common/energy/utils";
import { historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { ModeBadge } from "~/features/battery/components/ModeBadge";
import { DASH, kW, powerParts } from "~/features/common/formatting/utils/number";
import { useTween } from "~/features/common/ui/hooks/useTween";
import {
  codeName,
  degrees,
  hourIcon,
  liveWeather,
  liveWeatherIcon,
  type LiveWeather,
} from "~/features/common/weather/utils";
import { alpha, COLOR, DEVICE_COLORS } from "~/features/common/theme/utils/colors";
import { ARC_SMALL, BatteryArc } from "~/features/overview/components/BatteryArc";
import { BatteryPower } from "~/features/overview/components/BatteryPower";
import { HouseScene } from "~/features/overview/components/HouseScene";
import { houseOptions } from "~/features/overview/utils/house/options";

/** The drawing's frame: rounded, its own; what's over it (the weather card) can reach past it, onto the readout. */
const FRAME =
  "relative aspect-[1200/600] w-full rounded-[28px] max-md:aspect-[4/3] max-md:rounded-[22px] light:outline light:outline-line-subtle";

/** The power flow drawing with live values, drawn under the current weather. */
export function PowerFlowHero({
  p,
  s,
  f,
  now,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
}) {
  return (
    <section aria-label="Power flow" className="relative col-span-12 flex flex-col gap-3">
      {p ? <Scene p={p} s={s} f={f} now={now} /> : <div className={cn(FRAME, "bg-[#dcebff]")} />}
    </section>
  );
}

function Scene({
  p,
  s,
  f,
  now,
}: {
  p: Snapshot;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
}) {
  const wx = liveWeather(p, f, now, !!s?.temp_unit_f);
  const { data: cars } = useQuery(carsQuery);
  const flows = {
    pv: (p.pv_power || 0) / 1000,
    grid: (p.grid_power || 0) / 1000,
    bat: -(p.battery_power || 0) / 1000,
    soc: (p.battery_soc || 0) / 100,
    tesla: 0,
    conn: false,
    // With a second inverter, each one's own share, so each gets its own line from the roof.
    pvEach: p.pv2_power != null ? [(p.pv1_power ?? 0) / 1000, p.pv2_power / 1000] : undefined,
  };
  const dark = wx.mode === "night" || wx.mode === "storm";

  return (
    <>
      {/* No background under the scene: it covers the box, and a light one would show as a fringe
          around the rounded corners against a dark sky. The drawing is clipped to the corners on its own, so the
          weather card over it isn't. */}
      <div className={cn(FRAME, "whitespace-nowrap")}>
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          <HouseScene
            flows={flows}
            sky={wx.mode}
            cover={wx.cover}
            house={houseOptions(
              s,
              (cars ?? []).map((c) => c.car.car_park),
            )}
            cars={(cars ?? []).map((c) => ({
              body: c.car.car_body,
              paint: paintOf(c.car.car_colour).hex,
              label: [carName(c), c.level && `${Math.round(c.level.soc)}%`].filter(Boolean).join(" · "),
              href: `/settings/integrations/car/${c.id}`,
            }))}
            links
          />
        </div>
        {/* The heading follows the sky (dark at night and in storms), not the theme; what floats over it, the theme. */}
        <div className="absolute top-7 left-8 z-1 flex flex-col items-start gap-3 whitespace-normal max-md:top-3 max-md:left-3">
          <div className="flex flex-col gap-0.5 max-md:hidden">
            <h2
              className={cn(
                "text-[34px] leading-10 font-semibold tracking-[-0.9px] transition-colors duration-700",
                dark ? "text-white" : "text-[#1d1d1f]",
              )}
            >
              Power flow
            </h2>
            <span
              className={cn(
                "text-sm leading-5 transition-colors duration-700",
                dark ? "text-white/70" : "text-black/55",
              )}
            >
              Live from your inverter · updated every minute
            </span>
          </div>
          {/* when the figures were read and are next read, under the heading (phones show it under the drawing) */}
          <Timing ts={p.ts} className={cn(OVER, "rounded-full px-3 py-1.5 text-ink-sub max-md:hidden")} />
        </div>
        {/* the weather in the top right corner, opening down and to the left from it */}
        <div className="absolute top-7 right-8 z-1 whitespace-normal max-md:top-3 max-md:right-3">
          <Weather wx={wx} f={f} s={s} now={now} />
        </div>
      </div>

      <Readout p={p} s={s} now={now} soc={flows.soc} />
    </>
  );
}

/**
 * What floats over the drawing (the weather, when the figures were read, and the value cards from 2xl up): near-solid,
 * in the theme's colours rather than the sky's, so it all reads easily over any sky and sits at one depth. FLOAT is
 * the same, from 2xl up.
 */
const OVER =
  "border border-line-subtle bg-canvas/92 shadow-[0_14px_36px_-14px_rgb(0_0_0/0.55)] backdrop-blur-xl backdrop-saturate-150 light:bg-surface/90";

/** The weather's icons in colour (a sun behind cloud takes the sun's); plain cloud has none. */
const WEATHER_TINT: Partial<Record<IconName, string>> = {
  sun: COLOR.solar,
  cloudSun: COLOR.solar,
  moon: COLOR.solar,
  rain: COLOR.link,
  storm: COLOR.lilac,
};

/**
 * The weather now, in a capsule over the sky, as the value cards are: "☁ 27° Showers ⌄". Opening it grows the capsule itself into a
 * card, its width, height and corners easing together, with the hours ahead unfolding under the same line (the
 * weather, the chance of rain and the solar forecast for each) and when the weather was fetched and is next due. What
 * unfolds is laid out at the card's full width from the start, so nothing reflows as it grows; it stays mounted while
 * closed, so it eases out as well as in, and keeps fetching the weather on time.
 */
function Weather({
  wx,
  f,
  s,
  now,
}: {
  wx: LiveWeather;
  f: Forecast | null | undefined;
  s: SystemInfo | undefined;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  // The capsule's width when closed, measured from its line, so the card can grow from it (widths can't ease from auto).
  const [shut, setShut] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = line.current;
    if (!el) return;
    const measure = () => setShut(el.offsetWidth + CAPSULE_EXTRA);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wx.label]); // the line is remade when the weather changes (for its fade)
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const icon = liveWeatherIcon(wx);
  const tint = WEATHER_TINT[icon];
  const hours = (f?.hours ?? []).filter((h) => h.ts + 3600 > now).slice(0, AHEAD + 1);
  const timing = f?.weather;
  return (
    <div
      ref={box}
      className={cn(
        OVER,
        "relative z-2 flex flex-col overflow-hidden text-ink transition-[width,border-radius,background-color,color,box-shadow] duration-350 ease-(--ease-out-soft)",
        open ? "rounded-[20px]" : "rounded-[16px]",
      )}
      style={{ width: open ? CARD_W : shut != null ? `${shut}px` : undefined }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="weather-ahead"
        aria-label={`${wx.label}: the hours ahead`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] leading-5 font-medium text-inherit"
      >
        {/* keyed by the weather, so a change fades in rather than snapping */}
        <span ref={line} key={wx.label} className="flex w-max flex-none animate-fade items-center gap-1.5">
          <Icon name={icon} size={16} style={tint ? { color: tint } : { opacity: 0.75 }} />
          {wx.temp && <span className="font-semibold tabular-nums">{wx.temp}</span>}
          <span className="text-ink-muted">{wx.name}</span>
          {timing?.next_at != null && (
            // the open card's footer says it in full, so this fades as it opens
            <WeatherDueShort
              timing={timing}
              next={timing.next_at}
              className={cn("ml-1 transition-opacity duration-200", open && "opacity-0")}
            />
          )}
        </span>
        <Icon
          name="chevD"
          size={14}
          className={cn(
            "ml-auto flex-none pl-1.5 transition-transform duration-350 ease-(--ease-out-soft)",
            open && "rotate-180",
          )}
          style={{ opacity: 0.6, width: 20 }}
        />
      </button>
      <div
        id="weather-ahead"
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-350 ease-(--ease-out-soft)",
          open ? "grid-rows-[1fr] opacity-100 delay-50" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex w-[min(312px,calc(100vw-84px))] flex-col gap-3.5 px-3.5 pt-2 pb-3.5">
            {hours.length > 0 && (
              <Ahead
                key={String(open)}
                hours={hours}
                now={now}
                fahrenheit={!!s?.temp_unit_f}
                pvKw={s?.pv_kw}
                source={`Open-Meteo${s && s.weather_model !== "best_match" ? ` · ${MODEL_NAMES[s.weather_model]}` : ""}`}
              />
            )}
            {timing?.next_at != null && (
              <div
                className={cn(
                  "flex items-center border-t pt-3 text-xs leading-4 font-medium",
                  "border-line text-ink-muted",
                )}
              >
                <WeatherDue timing={timing} next={timing.next_at} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The card's width open (the hours' columns need it), short of a phone's edges. */
const CARD_W = "min(340px, calc(100vw - 56px))";
/** What the capsule adds around its line: its padding, the arrow, and its border. */
const CAPSULE_EXTRA = 20 + 20 + 2;

/** Hours shown after this one: few enough that each has room to read at a glance. */
const AHEAD = 4;
const MODEL_NAMES: Record<string, string> = { ecmwf_ifs025: "ECMWF", gfs_seamless: "GFS", icon_seamless: "ICON" };

/** An hour's label, short: "15:00", or "3pm". */
const shortHour = (ts: number) => hourLabel(new Date(ts * 1000).getHours()).replace(" ", "");

/**
 * The hours ahead, a column each: the hour, its weather, the temperature, the chance of rain when it's worth a mention,
 * and a bar of the solar forecast against the array's size (or the most of any hour shown).
 */
function Ahead({
  hours,
  now,
  fahrenheit,
  pvKw,
  source,
}: {
  hours: ForecastHour[];
  now: number;
  fahrenheit: boolean;
  pvKw: number | null | undefined;
  /** Where the weather is from: "Open-Meteo", with the model if one's been picked. */
  source: string;
}) {
  const top = Math.max(pvKw ?? 0, ...hours.map((h) => h.pv_kw), 0.1);
  const quiet = "text-ink-muted";
  return (
    <>
      <div className={cn("flex items-center justify-between text-xs leading-4 font-medium", quiet)}>
        <span>
          Next {AHEAD} hours · {source}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: COLOR.solar }} />
          Solar kW
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-5 gap-x-2 p-0">
        {hours.map((h, i) => {
          const icon = hourIcon(h);
          const tint = WEATHER_TINT[icon];
          const temp = h.temp != null ? degrees(h.temp, fahrenheit) : DASH;
          const wet = h.precip >= 20;
          return (
            <li
              key={h.ts}
              className="flex animate-rise flex-col items-center gap-2"
              style={{ animationDelay: `${i * 25}ms` }}
              title={[
                i === 0 && h.ts <= now ? "Now" : hhmm(h.ts),
                codeName(h.code),
                temp,
                wet && `${Math.round(h.precip)}% chance of rain`,
                `${kW(h.pv_kw * 1000)} solar`,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <span className={cn("text-xs leading-4 font-medium tabular-nums", i === 0 ? "font-semibold" : quiet)}>
                {i === 0 && h.ts <= now ? "Now" : shortHour(h.ts)}
              </span>
              <Icon name={icon} size={22} style={tint ? { color: tint } : { opacity: 0.75 }} />
              <span className="text-base leading-5 font-semibold tabular-nums">{temp}</span>
              <span className="h-4 text-xs leading-4 font-semibold tabular-nums" style={{ color: COLOR.link }}>
                {wet ? `${Math.round(h.precip)}%` : ""}
              </span>
              <span className={cn("flex h-8 w-2.5 items-end overflow-hidden rounded-full", "bg-fg/8")}>
                <span
                  className="w-full rounded-full transition-[height] duration-700 ease-(--ease-out-soft)"
                  style={{
                    height: `${Math.min(100, (h.pv_kw / top) * 100)}%`,
                    background: COLOR.solar,
                  }}
                />
              </span>
              <span className={cn("text-xs leading-4 font-medium tabular-nums", quiet)}>
                {h.pv_kw >= 0.05 ? h.pv_kw.toFixed(1) : DASH}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** How long until the weather's due again, compact, for the closed capsule: "◔ 9m". */
function WeatherDueShort({ timing, next, className }: { timing: WeatherTiming; next: number; className?: string }) {
  const now = useClock(1000);
  const left = next - now;
  const retry = !!timing.error;
  const busy = left <= 0;
  return (
    <span
      aria-hidden
      className={cn(
        "flex items-center gap-1 text-xs font-medium tabular-nums",
        retry ? "text-warn" : "text-ink-muted",
        className,
      )}
    >
      <Ring due={next} left={left} interval={retry ? RETRY_GUESS : timing.every} busy={busy} size={12} />
      {busy ? "…" : left >= 60 ? `${Math.ceil(left / 60)}m` : clock(left)}
    </span>
  );
}

/**
 * When the weather was fetched and how long until it's due again. Once it's due, the forecast is asked for again (a
 * few seconds on), which fetches it if the server's loop hasn't, so the new weather shows without waiting for the
 * forecast's own refresh.
 */
function WeatherDue({ timing, next }: { timing: WeatherTiming; next: number }) {
  const now = useClock(1000);
  const qc = useQueryClient();
  useEffect(() => {
    const id = setTimeout(
      () => void qc.invalidateQueries({ queryKey: forecastQuery.queryKey, exact: true }),
      Math.max(0, (next + 3) * 1000 - Date.now()),
    );
    return () => clearTimeout(id);
  }, [next, qc]);
  const left = next - now;
  const retry = !!timing.error;
  const busy = left <= 0;
  const wait = left >= 60 ? `${Math.ceil(left / 60)} min` : clock(left);
  return (
    <span
      className={cn("flex items-center gap-1.5", retry && "text-warn")}
      title={retry ? "Open-Meteo couldn't be reached; trying again" : `Fetched every ${duration(timing.every)}`}
    >
      <Ring due={next} left={left} interval={retry ? RETRY_GUESS : timing.every} busy={busy} size={12} />
      <span className="tabular-nums" role="timer" aria-live="off">
        {[
          timing.fetched_at != null && `Updated ${hhmm(timing.fetched_at)}`,
          busy ? "updating…" : `${retry ? "retrying" : "next"} in ${wait}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

/** How long the server waits to try the weather again after a failed fetch (WeatherService.RETRY), for the ring. */
const RETRY_GUESS = 300;

/** The time now (unix seconds), every `ms`: for a countdown, so only it re-renders as it ticks. */
function useClock(ms: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** When the figures were read and how long until they're read again, as the weather capsule writes it: "Updated
 * 15:11 ◔ 0:25". */
function Timing({ ts, className }: { ts: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 text-[13px] leading-5 font-medium", className)}>
      <span key={ts} className="animate-fade tabular-nums">
        Updated <span className="font-semibold">{hhmm(ts)}</span>
      </span>
      <NextPoll />
    </div>
  );
}

/**
 * Counts down to the collector's next read of the inverters, just the ring and the time left ("◔ 0:25"), ticking on its
 * own so the scene doesn't re-render each second; amber while the inverter isn't answering.
 */
function NextPoll() {
  const st = useLive();
  const now = useClock(500);
  const next = st?.next_poll;
  if (!st || next == null) return null;
  const left = next - now;
  // Long past: the status has stopped arriving (the collector's unreachable), so there's nothing to count to.
  if (left < -30) return null;
  const interval = st.poll_interval || 60;
  const retry = !!st.error;
  const reading = left <= 0;
  return (
    <span
      className={cn("flex items-center gap-1", retry && "text-warn")}
      title={
        retry
          ? `The inverter didn't answer; trying again in ${clock(left)}`
          : `Next reading in ${clock(left)}: the inverters are read every ${duration(interval)}`
      }
    >
      <Ring due={next} left={left} interval={interval} busy={reading} size={12} />
      <span
        className="tabular-nums"
        role="timer"
        aria-live="off"
        aria-label={reading ? "Reading now" : `${retry ? "Retrying" : "Next reading"} in ${clock(left)}`}
      >
        {reading ? "…" : clock(left)}
      </span>
    </span>
  );
}

const ARC = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", pathLength: 1 } as const;

/**
 * A countdown's ring: it drains smoothly over the interval to the next refresh (a CSS animation, restarted for each
 * one), and turns while a refresh is under way.
 */
function Ring({
  due,
  left,
  interval,
  busy,
  size = 14,
}: {
  due: number;
  left: number;
  interval: number;
  busy: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden
      className={cn("flex-none -rotate-90", busy && "animate-[wmpSpin_1s_linear_infinite]")}
    >
      <circle cx={7} cy={7} r={5.5} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} />
      {busy ? (
        <circle cx={7} cy={7} r={5.5} {...ARC} strokeDasharray="0.3 1" />
      ) : (
        <Drain key={due} left={left} interval={interval} />
      )}
    </svg>
  );
}

/** The ring's arc, draining from where it is when a countdown starts: keyed by what's counted down to, so where it
 * starts is worked out once and the animation runs on its own. */
function Drain({ left, interval }: { left: number; interval: number }) {
  const [delay] = useState(() => Math.min(left, interval) - interval);
  return (
    <circle
      cx={7}
      cy={7}
      r={5.5}
      {...ARC}
      strokeDasharray="1 1"
      style={{ animation: `wmpDrain ${interval}s linear ${delay.toFixed(2)}s both` }}
    />
  );
}

/**
 * The live values, a card each: from 2xl up, frosted over the drawing, solar, the grid and the battery down the left
 * and the home on the right; narrower, under it, the home first and the other three in a row. When the plugs and
 * appliances say what they're drawing, the home's card shows it: a bar of them and everything else, then each by
 * name, with the home's own line under them.
 */
function Readout({ p, s, now, soc }: { p: Snapshot; s: SystemInfo | undefined; now: number; soc: number }) {
  const { data: home } = useQuery(homeQuery);
  const { grid_power: g, battery_power: b, load_power: l } = p;
  // The figures glide to each minute's reading; the scene's flows and states follow the reading itself.
  const tween = { pv: useTween(p.pv_power), g: useTween(g), l: useTween(l), b: useTween(b) };
  const parts = (w: number | null | undefined) => (w == null ? [DASH, "kW"] : powerParts(w));
  const [pv, grid, use] = [parts(tween.pv), parts(tween.g), parts(tween.l)];
  const st = batteryState(b);
  const devices = home?.devices ?? [];
  const split = liveBreakdown(devices, l);
  const colors = deviceColors(devices);

  // The last two hours behind each figure. The window follows the latest reading, so it moves (and is fetched) once a
  // reading, and the line always ends at the figure in front of it.
  const { data: hist } = useQuery({
    ...historyQuery({ start: p.ts - SPARK_SPAN, end: p.ts, points: 48, fields: SPARK_FIELDS }),
    placeholderData: keepPreviousData,
  });
  const spark = (
    field: string,
    color: string,
    live: number | null | undefined,
    range?: [number, number],
    tone?: SparkTone,
  ) =>
    hist ? (
      <Spark
        series={hist.series}
        field={field}
        live={live}
        start={p.ts - SPARK_SPAN}
        end={p.ts}
        color={color}
        range={range}
        tone={tone}
      />
    ) : null;
  const sun = (p.pv_power ?? 0) > ON;
  const dir = g == null ? null : g > ON ? "in" : g < -ON ? "out" : null;
  const gridColor = dir === "in" ? COLOR.import : dir === "out" ? COLOR.export : COLOR.ink;
  const cell = { ts: p.ts };
  // the battery in its blue, amber while it discharges: its card, ring, icon and line, as on the Battery card
  const batColor = batteryTone(b);

  return (
    // From 2xl up (where the drawing's tall enough to leave the heading clear), floating over its bottom corners (the
    // section is the drawing's height then): solar, the grid and the battery down the left, the home on the right.
    // Narrower, under the drawing: the home, then the other three in a row (on phones, under when they were read).
    <div className="flex flex-col gap-2 2xl:pointer-events-none 2xl:absolute 2xl:inset-x-6 2xl:bottom-6 2xl:flex-row 2xl:items-end 2xl:justify-between 2xl:gap-6">
      <div className="flex w-[212px] flex-col gap-2 max-2xl:contents 2xl:pointer-events-auto">
        {/* on phones, where the drawing has no heading to put it under */}
        <Timing ts={p.ts} className="justify-between px-1.5 text-ink-muted md:hidden" />
        <div className="grid grid-cols-3 gap-2 max-2xl:order-last 2xl:grid-cols-1">
          <Cell
            {...cell}
            i={0}
            to="/solar"
            go="Solar"
            tint={COLOR.solar}
            spark={spark("pv_power", COLOR.solar, p.pv_power, [0, (s?.pv_kw ?? 0) * 1000])}
            icon={
              // turning slowly while the panels make power; dimmed at night
              <Icon
                name="sun"
                size={18}
                className={cn(
                  "transition-opacity duration-700",
                  sun ? "animate-[wmpSpin_24s_linear_infinite]" : "opacity-50",
                )}
              />
            }
            iconStyle={{ background: alpha(COLOR.solar, sun ? 0.18 : 0.08), color: COLOR.solar }}
            k="Solar"
            v={pv[0]}
            unit={pv[1]}
            title={
              p.pv2_power != null
                ? `Hybrid ${kW(p.pv1_power)} · ${s?.pv2?.model || "Second inverter"} ${kW(p.pv2_power)}`
                : undefined
            }
          />
          <Cell
            {...cell}
            i={1}
            to="/grid"
            go="Grid"
            tint={dir ? gridColor : COLOR.fg}
            spark={spark("grid_power", dir === "out" ? COLOR.export : COLOR.import, g)}
            icon={<Icon name="grid" size={18} />}
            // tinted by which way the power's going: in from the grid, or out to it
            iconStyle={{ background: dir ? alpha(gridColor, 0.18) : alpha(COLOR.fg, 0.08), color: gridColor }}
            k={gridVerb(g)}
            v={grid[0]}
            unit={grid[1]}
          />
          <Cell
            {...cell}
            i={2}
            to="/battery"
            go="Battery"
            tint={batColor}
            spark={spark("battery_soc", COLOR.battery, p.battery_soc, [0, 100], {
              field: "battery_power",
              live: b,
              color: batteryTone,
            })}
            icon={
              // the Battery card's ring, small: drawn in, easing to each reading, with its streak while power moves
              <>
                <BatteryArc frac={soc} st={st} size={ARC_SMALL} />
                <Icon
                  key={st === "discharge" ? "out" : "in"}
                  name={st === "discharge" ? "batteryDraining" : "battery"}
                  size={15}
                  className="relative animate-fade transition-colors duration-500"
                  style={{ color: batColor }}
                />
                <ModeBadge now={now} ring="var(--tile)" />
              </>
            }
            iconClassName="relative"
            iconStyle={{}}
            k="Battery"
            v={String(Math.round(p.battery_soc ?? 0))}
            unit="%"
            // in the corner, so the card's no taller than the others; the Battery card just below shows the rate, so
            // phones (three cells across) drop it
            corner={
              st === "charge" || st === "discharge" ? (
                <BatteryPower st={st} w={tween.b} className="max-md:hidden" />
              ) : null
            }
          />
        </div>
      </div>
      <Cell
        {...cell}
        i={3}
        to="/home"
        go="Home"
        tint={COLOR.fg}
        className="2xl:pointer-events-auto 2xl:w-[320px]"
        wide
        icon={<Icon name="home" size={18} />}
        iconStyle={{ background: COLOR.ink, color: COLOR.canvas }}
        k="Home"
        v={`${l != null && l < 0 ? "−" : ""}${use[0]}`}
        unit={use[1]}
      >
        {split && <HomeSplit split={split} colors={colors} />}
        {/* the home's line under the rooms, edge to edge, in the room they leave: it shrinks as the list grows,
              rather than running through their names */}
        <div className="relative -mx-4 -mb-4 min-h-14 flex-1 max-md:-mx-3 max-md:-mb-3.5">
          {spark("load_power", COLOR.ink, l)}
        </div>
      </Cell>
    </div>
  );
}

/** OVER, from 2xl up, where the readout floats over the drawing (Tailwind needs each class written out in full). */
const FLOAT = cn(
  // the canvas's near-black in the dark theme (darker than the page's cards); the surface's white in the light one
  "2xl:bg-canvas/92 2xl:[--tile:var(--color-canvas)] 2xl:light:bg-surface/90 2xl:light:[--tile:var(--color-surface)]",
  "2xl:shadow-[0_14px_36px_-14px_rgb(0_0_0/0.55)] 2xl:backdrop-blur-xl 2xl:backdrop-saturate-150",
);

/** A readout card, as the page's own cards are (frosted over the drawing), its corners clipping what runs edge to edge
 * in it (the line). */
const CARD = cn(
  "relative overflow-hidden rounded-[20px] border border-line-subtle bg-(--tile) [--tile:var(--color-surface)]",
  FLOAT,
);

/** Rooms and devices with a colour of their own in the bar (as many as the palette has); the rest share a hatch. */
const SHOWN = DEVICE_COLORS.length;
/** Rooms and devices named in the home's card, the most first; past these, "N more" links to the Home page. */
const LISTED = 11;

type Split = NonNullable<ReturnType<typeof liveBreakdown>>;

/**
 * What the home is drawing: a bar of the biggest few, the rest together, and everything else, then every room and
 * device by name, the most first, with room for ten or so. One with a colour on the Home page keeps it; one past the
 * palette borrows a colour none of the others shown has, and past those they share the hatch.
 */
function HomeSplit({ split, colors }: { split: Split; colors: Map<number, string> }) {
  const { parts, measured, other } = split;
  const total = measured + other;
  const shown = parts.slice(0, SHOWN);
  const rest = parts.slice(SHOWN);
  const restW = rest.reduce((a, x) => a + x.w, 0);
  const own = (id: number) => colors.get(id);
  const free = DEVICE_COLORS.filter((c) => !shown.some((x) => own(x.id) === c));
  const color = new Map(
    shown.map((x) => [
      x.id,
      own(x.id) && DEVICE_COLORS.includes(own(x.id)!) ? own(x.id)! : (free.shift() ?? OTHER_COLOR),
    ]),
  );
  const bar = [
    ...shown.map((x) => ({ key: String(x.id), name: x.name, w: x.w, bg: color.get(x.id)! })),
    { key: "rest", name: `${rest.length} more`, w: restW, bg: REST_BG },
    { key: "other", name: "Everything else", w: other, bg: OTHER_COLOR },
  ].filter((x) => x.w > 0);
  const listed = parts.slice(0, LISTED);
  const unlisted = parts.slice(LISTED);
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div
        className="flex h-2 origin-left animate-fill-x gap-[3px]"
        role="img"
        aria-label={bar.map((x) => `${x.name} ${kW(x.w)}`).join(", ")}
      >
        {bar.map((x) => (
          <span
            key={x.key}
            title={`${x.name} · ${kW(x.w)}`}
            className="min-w-1 rounded-full transition-[flex-grow] duration-1000 ease-(--ease-out-soft)"
            style={{ flexGrow: x.w / total, background: x.bg }}
          />
        ))}
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-6 gap-y-2.5 p-0 text-[13px] leading-4 max-md:grid-cols-2 max-md:gap-x-4 2xl:grid-cols-2 2xl:gap-x-4">
        {listed.map((x, i) => (
          <Part key={x.id} x={x} color={color.get(x.id) ?? REST_BG} i={i} />
        ))}
        {unlisted.length > 0 && (
          <li className="flex min-w-0 items-center gap-2">
            <span className="size-2 flex-none rounded-full" style={{ background: REST_BG }} />
            <Link to="/home" className="truncate text-ink-sub no-underline transition-colors hover:text-ink">
              {unlisted.length} more
            </Link>
            <b className="ml-auto pl-1 font-semibold whitespace-nowrap text-ink tabular-nums">
              {kW(unlisted.reduce((a, x) => a + x.w, 0))}
            </b>
          </li>
        )}
        {other > 0 && (
          <li className="col-span-full flex min-w-0 items-center gap-2" title="What no plug or appliance measures">
            <span className="size-2 flex-none rounded-full" style={{ background: OTHER_COLOR }} />
            <span className="truncate text-ink-sub">Everything else</span>
            <b className="ml-auto pl-1 font-semibold whitespace-nowrap text-ink tabular-nums">{kW(other)}</b>
          </li>
        )}
      </ul>
    </div>
  );
}

/** The quieter, hatched colour of the devices past the biggest few, together in the bar. */
const REST_BG = `repeating-linear-gradient(135deg, ${OTHER_COLOR} 0 2px, transparent 2px 4px)`;

/** A room or device in the home's breakdown: its dot in its colour in the bar (or the hatch), its name and power. */
function Part({ x, color, i }: { x: LivePart; color: string; i: number }) {
  const name = "truncate text-ink-sub no-underline transition-colors hover:text-ink";
  return (
    <li className="flex min-w-0 animate-rise items-center gap-2" style={{ animationDelay: `${120 + i * 25}ms` }}>
      <span
        className="size-2 flex-none rounded-full transition-[background] duration-500"
        style={{ background: color }}
      />
      {x.group ? (
        <Link to="/home" className={name}>
          {x.name}
        </Link>
      ) : (
        <Link to="/home/$device" params={{ device: String(x.id) }} className={name}>
          {x.name}
        </Link>
      )}
      <b className="ml-auto pl-1 font-semibold whitespace-nowrap text-ink tabular-nums">{kW(x.w)}</b>
    </li>
  );
}

/**
 * A live value in a card of its own: a tinted icon, what it is and how much, padded in from the card's edges, over a
 * faint line of its last two hours running edge to edge along its bottom. The whole card links on (`to`), lighting up
 * under the pointer and giving a little when pressed; a fresh reading (`ts`) sends a sheen across it, each cell
 * a beat after the one before (`i`), as they rise into place on arriving. On phones the icon sits over the value, for a
 * row of three or four; `wide` (the home's card) puts the figure at the top, with what follows (its breakdown) under it.
 */
function Cell({
  className,
  i,
  ts,
  to,
  go,
  tint,
  spark,
  icon,
  iconClassName,
  iconStyle,
  k,
  v,
  unit,
  corner,
  title,
  wide,
  children,
}: {
  className?: string;
  i: number;
  ts: number;
  /** Its live page: Solar, Grid, Battery or Home. */
  to: "/solar" | "/grid" | "/battery" | "/home";
  /** Its colour, for the wash and edge it takes on under the pointer (solar's yellow, the battery's blue…). */
  tint: string;
  /** Where it links, in a word, for screen readers: "Solar". */
  go: string;
  spark?: ReactNode;
  icon: ReactNode;
  iconClassName?: string;
  iconStyle: CSSProperties;
  k: string;
  v: string;
  unit: string;
  /** In the top right corner, small: the battery's charge rate. */
  corner?: ReactNode;
  title?: string;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      title={title}
      className={cn(
        CARD,
        "group flex min-w-0 animate-rise items-center gap-3 px-4 pt-3.5 pb-4 transition-[scale,border-color] duration-200 has-[>a:active]:scale-[0.985] has-[>a:hover]:border-(--edge) max-md:px-3 max-md:pt-3 max-md:pb-3.5 2xl:gap-2.5 2xl:px-3.5 2xl:py-2.5",
        wide && "flex-col items-stretch justify-start gap-4",
        className,
      )}
      style={
        {
          animationDelay: `${i * 50}ms`,
          "--wash": alpha(tint, 0.04),
          "--press": alpha(tint, 0.08),
          "--edge": alpha(tint, 0.2),
        } as CSSProperties
      }
    >
      {/* the cell as a link: under everything, so the home's own links and button still take their clicks */}
      <Link
        to={to}
        aria-label={`${k} ${v} ${unit}: ${go}`}
        className="absolute inset-0 rounded-[inherit] transition-colors duration-200 hover:bg-(--wash) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand active:bg-(--press)"
      />
      {/* edge to edge along the bottom, under the padded content */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 max-md:h-2/5">{spark}</div>
      {/* the sheen, across the card on each fresh reading */}
      <span
        key={ts}
        aria-hidden
        className="pointer-events-none absolute inset-0 animate-[wmpSheen_1.1s_var(--ease-out-soft)_both]"
        style={{
          animationDelay: `${120 + i * 70}ms`,
          background: `linear-gradient(100deg, transparent 30%, ${alpha(COLOR.fg, 0.07)} 50%, transparent 70%)`,
        }}
      />
      {corner && <div className="pointer-events-none absolute top-3 right-3.5 2xl:top-2.5 2xl:right-3">{corner}</div>}
      <div
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-none items-center gap-3",
          !wide && "max-md:flex-col max-md:items-start max-md:gap-2.5",
        )}
      >
        <div
          className={cn(
            "flex size-9 flex-none items-center justify-center rounded-full transition-[background-color,color,scale] duration-500 group-hover:scale-105 max-md:size-8 2xl:size-8",
            iconClassName,
          )}
          style={iconStyle}
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          {/* keyed, so a change ("Importing" to "Exporting") fades in */}
          <span key={k} className="animate-fade truncate text-[13px] leading-4 font-medium text-ink-muted">
            {k}
          </span>
          <span className="text-[26px] leading-7 font-semibold tracking-[-0.04em] whitespace-nowrap tabular-nums max-md:text-xl max-md:leading-6 2xl:text-[22px] 2xl:leading-6">
            {v}
            <small className="ml-1 text-[13px] font-medium tracking-normal text-ink-muted">{unit}</small>
          </span>
        </div>
      </div>
      {children && (
        // positioned over the card's link, so the home's own links take their clicks; anywhere else (the bar, the line, the
        // gaps) lets the click through to the card's
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto",
            wide && "flex-col gap-4",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const SPARK_SPAN = 2 * 3600;
const SPARK_FIELDS = ["pv_power", "grid_power", "battery_soc", "battery_power", "load_power"];

/** The line coloured point by point from another field (the battery's charge by whether it's charging). */
type SparkTone = { field: string; live: number | null | undefined; color: (v: number | null | undefined) => string };

/**
 * A faint line of a field over [start, end], with the live value at its end, filled down to zero (or up to it, for
 * power sent to the grid), and fading in from the left. `range` is the scale's [low, high] at the least, which a
 * reading beyond widens; it draws in from the left the first time. Given `tone`, each stretch of the line takes the
 * colour of the reading it ends at.
 */
function Spark({
  series,
  field,
  live,
  start,
  end,
  color,
  range,
  tone,
}: {
  series: HistorySeries;
  field: string;
  live: number | null | undefined;
  start: number;
  end: number;
  color: string;
  range?: [number, number];
  tone?: SparkTone;
}) {
  const pts: [number, number, string][] = [];
  const vs = series[field] ?? [];
  const ts = tone && series[tone.field];
  series.t.forEach((t, i) => {
    const v = vs[i];
    if (v != null && t >= start && t < end) pts.push([t, v, tone ? tone.color(ts?.[i]) : color]);
  });
  if (live != null) pts.push([end, live, tone ? tone.color(tone.live) : color]);
  if (pts.length < 2) return null;
  const values = pts.map(([, v]) => v);
  const lo = Math.min(range?.[0] ?? 0, 0, ...values);
  const hi = Math.max(range?.[1] ?? 0, ...values, lo + 1);
  const x = (t: number) => ((t - start) / (end - start)) * 100;
  const y = (v: number) => 38 - ((v - lo) / (hi - lo)) * 34;
  const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(2)} ${y(v).toFixed(2)}`).join("");
  const zero = y(0).toFixed(2);
  // the line in runs of one colour, each picking up from where the last left off
  const runs: { d: string; c: string }[] = [];
  pts.slice(1).forEach(([t, v, c], i) => {
    const at = `L${x(t).toFixed(2)} ${y(v).toFixed(2)}`;
    const run = runs[runs.length - 1];
    if (run?.c === c) run.d += at;
    else runs.push({ c, d: `M${x(pts[i][0]).toFixed(2)} ${y(pts[i][1]).toFixed(2)}${at}` });
  });
  const area = `${line}L${x(pts[pts.length - 1][0]).toFixed(2)} ${zero}L${x(pts[0][0]).toFixed(2)} ${zero}Z`;
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden
      className="absolute inset-0 size-full animate-reveal-x"
      style={{ maskImage: "linear-gradient(to right, transparent, black 45%)" }}
    >
      <path d={area} fillOpacity={0.07} style={{ fill: color }} />
      {runs.map((r, k) => (
        <path
          key={k}
          d={r.d}
          fill="none"
          strokeOpacity={0.4}
          strokeWidth={1.25}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: r.c }}
        />
      ))}
    </svg>
  );
}
