import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { useHasBattery } from "~/features/battery/hooks";
import { ON, reserveOf } from "~/features/common/energy/utils";
import { duration, hhmm, hourLabel, weekdayShort } from "~/features/common/formatting/utils/date";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { sameDay } from "~/features/common/time/utils";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { dim, usePick } from "~/features/common/ui/components/Pick";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import type { Forecast } from "~/features/common/weather/types";
import { gridQuery, refreshGrid } from "~/features/grid/api";
import { PLANNED, RADII, UNPLANNED } from "~/features/grid/components/OutagesCard";
import type { GridView, HazardsView, Outage, OutagesView } from "~/features/grid/types";
import { LEVEL, listed, perMWh, wholesaleCents, wholesaleKind } from "~/features/grid/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";

/*
 * The Grid page's cards under its top card: simple ones, each a title with a word on it in the corner, one picture of
 * the day (bars, a list, a range) and a sentence on what it means. The fuller versions (the market's chart, the outage
 * radar, voltage through the day) are dashboard widgets.
 */

const HOUR = 3600;

/** A card with a title, a word on it in the corner, and what's in it. */
function Tile({
  title,
  aside,
  children,
  className,
  style,
  dot,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** A dot before the title in this colour (the urgent card's level). */
  dot?: string;
}) {
  return (
    <Card
      className={cn("gap-3.5 rounded-[22px] px-[22px] py-5 max-sm:rounded-[22px] max-sm:px-5", className)}
      style={style}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base leading-6 font-bold tracking-normal">
          {dot && (
            <i
              aria-hidden
              className="size-2 flex-none rounded-full"
              style={{ background: dot, boxShadow: `0 0 0 3px ${alpha(dot, 0.25)}` }}
            />
          )}
          {title}
        </h2>
        {aside && <span className="min-w-0 truncate text-xs text-ink-faint">{aside}</span>}
      </div>
      {children}
    </Card>
  );
}

/** What a card's picture means, in a sentence or two. */
function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-[13.5px] leading-5 text-pretty text-ink-muted", className)}>{children}</p>;
}

/** A line in a card's list: what on the left, when or where on the right, with a dot in its colour. */
function Line({
  dot,
  children,
  right,
  href,
}: {
  dot?: string;
  children: ReactNode;
  right?: ReactNode;
  href?: string | null;
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {dot && <i aria-hidden className="size-2 flex-none rounded-full" style={{ background: dot }} />}
        <span className="min-w-0 text-pretty">{children}</span>
      </span>
      {right && <span className="flex-none text-ink-faint tabular-nums">{right}</span>}
    </>
  );
  const cls =
    "flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-fg/4 px-3 py-2.5 text-[13px] text-ink no-underline";
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(cls, "transition-colors hover:bg-fg/7 hover:text-ink")}
    >
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Midnight, noon and midnight under a day's picture. */
function DayAxis() {
  return (
    <div aria-hidden className="-mt-1.5 flex justify-between text-[11px] text-ink-faint tabular-nums">
      <span>{hourLabel(0)}</span>
      <span>{hourLabel(12)}</span>
      <span>{hourLabel(24)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- the market

type Hour = { h: number; price: number | null; forecast: boolean };

/** Today hour by hour at the wholesale price: the five-minute prices where there are, AEMO's forecast after. */
function hours(grid: GridView, start: number): Hour[] {
  return Array.from({ length: 24 }, (_, h) => {
    const a = start + h * HOUR;
    const inside = grid.prices.filter((x) => x.price != null && x.at > a && x.at <= a + HOUR);
    const actual = inside.filter((x) => !x.forecast);
    const use = actual.length ? actual : inside;
    const price = use.length ? use.reduce((s, x) => s + x.price!, 0) / use.length : null;
    return { h, price, forecast: !actual.length };
  });
}

const kind = wholesaleKind;

/** The hours either side of `i` priced like it (cheap with cheap, dear with dear): "from 10 am to 2 pm". */
function run(list: Hour[], i: number): string {
  const k = kind(list[i].price);
  let a = i;
  let b = i;
  if (k !== "mid") {
    while (a > 0 && kind(list[a - 1].price) === k) a--;
    while (b < 23 && kind(list[b + 1].price) === k) b++;
  }
  return a === b ? `around ${hourLabel(list[i].h)}` : `from ${hourLabel(a)} to ${hourLabel(b + 1)}`;
}

/** What the forecast has the house doing on the grid in the hour from `t`, if it's still to come: " You're likely to
 * sell about 1.2 kWh then." */
function likely(f: Forecast | null | undefined, t: number, now: number): string {
  if (t + HOUR <= now) return "";
  const h = f?.hours.find((x) => x.ts === t);
  if (!h) return "";
  if (h.grid_kwh > 0.05) return ` You're likely to buy about ${kWh(h.grid_kwh)} then.`;
  if (h.grid_kwh < -0.05) return ` You're likely to sell about ${kWh(-h.grid_kwh)} then.`;
  return " Your solar and battery should have the house covered then.";
}

/**
 * What power sells for in the region today, before network charges: each hour as a bar (teal when cheap, orange when
 * dear, this hour outlined), and a sentence on the price now and when it's cheapest and dearest. Pointing at an hour
 * (or tapping it) reads it out in the corner and the sentence: its price, and for the hours ahead, what the forecast
 * (`f`) has the house buying or selling then. AEMO's notices about tight supply, while there are any.
 */
export function WholesaleCard({
  grid,
  start,
  now,
  f,
}: {
  grid: GridView;
  start: number;
  now: number;
  f?: Forecast | null;
}) {
  const { picked, plot, item } = usePick();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      qc.setQueryData(gridQuery.queryKey, await refreshGrid());
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const list = hours(grid, start);
  const priced = list.filter((x) => x.price != null);
  const top = Math.max(100, ...priced.map((x) => x.price!));
  const nowH = Math.floor((now - start) / HOUR);
  const price = grid.market?.price ?? null;
  const low = priced.length ? list.indexOf(priced.reduce((a, x) => (x.price! < a.price! ? x : a))) : -1;
  const high = priced.length ? list.indexOf(priced.reduce((a, x) => (x.price! > a.price! ? x : a))) : -1;
  const active = grid.notices.filter((n) => n.active && !n.cancels).sort((a, b) => b.at - a.at);
  const pick = picked != null ? list[picked] : null;
  if (!grid.enabled)
    return (
      <Tile title="Wholesale market" aside="AEMO">
        <Note>
          Choose your region for what power sells for before network charges, and AEMO's warnings about tight supply.{" "}
          <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
            Choose your region
          </Link>
        </Note>
      </Tile>
    );
  return (
    <Tile
      title="Wholesale market"
      aside={
        pick?.price != null ? (
          <span className="text-ink tabular-nums" aria-live="polite">
            {hourLabel(pick.h)}–{hourLabel(pick.h + 1)} · {wholesaleCents(pick.price)}
          </span>
        ) : (
          `${grid.region_name ?? "AEMO"} · c/kWh`
        )
      }
    >
      {priced.length > 0 && (
        <>
          <div className="grid h-14 grid-cols-24 gap-0.5" {...plot}>
            {list.map((x) => {
              const k = kind(x.price);
              return (
                <button
                  key={x.h}
                  type="button"
                  disabled={x.price == null}
                  aria-label={
                    x.price == null
                      ? undefined
                      : `${hourLabel(x.h)} to ${hourLabel(x.h + 1)}: ${wholesaleCents(x.price)}${x.forecast ? ", forecast" : ""}`
                  }
                  {...item(x.h)}
                  className={cn("flex h-full cursor-pointer items-end border-0 bg-transparent p-0", dim(picked, x.h))}
                >
                  <i
                    className={cn(
                      "w-full rounded-t-[3px] rounded-b-[1px] transition-[height] duration-200",
                      x.h === nowH && x.price != null && "outline-2 outline-offset-1 outline-ink",
                    )}
                    style={{
                      height: `${x.price == null ? 0 : Math.max(6, (Math.max(0, x.price) / top) * 100)}%`,
                      background: k === "cheap" ? COLOR.teal : k === "dear" ? COLOR.export : "var(--color-ink-faint)",
                      opacity: picked === x.h ? 1 : k === "cheap" ? 0.75 : k === "dear" ? 0.8 : 0.45,
                    }}
                  />
                </button>
              );
            })}
          </div>
          <DayAxis />
        </>
      )}
      {grid.error ? (
        <Note className="text-warn">
          {grid.error}{" "}
          <Button variant="link" size="sm" onClick={retry} disabled={busy} className="h-auto p-0 align-baseline">
            {busy ? "Trying…" : "Try again"}
          </Button>
        </Note>
      ) : pick?.price != null ? (
        <Note>
          <span className="text-ink">{wholesaleCents(pick.price)} a kWh</span> from {hourLabel(pick.h)} to{" "}
          {hourLabel(pick.h + 1)} ({perMWh(pick.price)}){pick.forecast ? ", as AEMO forecasts it" : ""}.
          {likely(f, start + pick.h * HOUR, now)}
        </Note>
      ) : priced.length ? (
        <Note>
          {price != null && (
            <span className={cn("text-ink", price >= grid.limits.spike && "text-warn")}>
              {wholesaleCents(price)} a kWh now.{" "}
            </span>
          )}
          Cheapest at {wholesaleCents(list[low].price)} {run(list, low)}, dearest at {wholesaleCents(list[high].price)}{" "}
          {run(list, high)}.
        </Note>
      ) : (
        <Note>Waiting for AEMO's prices.</Note>
      )}
      {active.length > 0 && (
        <div className="flex flex-col gap-2">
          {active.slice(0, 3).map((n) => (
            <Line
              key={n.id}
              dot={
                n.level === "critical" ? COLOR.danger : n.level === "warning" ? COLOR.warn : "var(--color-ink-faint)"
              }
              right={hhmm(n.at)}
            >
              {n.title}
            </Line>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------- outages

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const placeOf = (o: Outage) => (o.suburbs.length ? title(o.suburbs[0]) : "area not given");
const dayOf = (t: number, now: number) => (sameDay(t, now) ? "Today" : weekdayShort.format(t * 1000));

/** When, in a few words: "Back by 3:00 pm", "Tue 8:00 am–2:00 pm". */
function shortWhen(o: Outage, now: number): string {
  if (!o.planned || (o.start != null && o.start <= now)) {
    if (o.end) return `Back by ${hhmm(o.end)}`;
    if (o.end_text) return title(o.end_text);
    return o.start ? `Since ${hhmm(o.start)}` : "Now";
  }
  if (!o.start) return "Planned";
  return `${dayOf(o.start, now)} ${hhmm(o.start)}${o.end && sameDay(o.start, o.end) ? `–${hhmm(o.end)}` : ""}`;
}

/** When planned work is, in a sentence: " today from 8:00 am to 2:00 pm", " on Tue from 8:00 am". */
function planned(o: Outage, now: number): string {
  if (!o.start) return "";
  const day = sameDay(o.start, now) ? "today" : `on ${weekdayShort.format(o.start * 1000)}`;
  return ` ${day} from ${hhmm(o.start)}${o.end ? ` to ${hhmm(o.end)}` : ""}`;
}

/** How far away, and which way: "3.2 km NW", "Under 1 km away". */
const away = (o: Outage) =>
  o.distance_km < 1 ? "Under 1 km away" : `${+o.distance_km.toFixed(1)} km ${o.direction}`.trim();

const SHOWN = 4;

/**
 * The network's outages around the house as a short list, outages now (orange) before planned work (purple), each
 * through to the network's own page for it, and a sentence on whether any of it reaches you.
 */
export function OutagesNearby({ view, now }: { view: OutagesView; now: number }) {
  const [all, setAll] = useState(false);
  const net = view.network;
  const sources = listed(view.networks.map((n) => n.name)) || net?.name || "";
  if (!net)
    return (
      <Tile title="Outages nearby">
        {!view.location_set ? (
          <LocationPrompt>Set your location to see outages around your house.</LocationPrompt>
        ) : view.supported ? (
          <Note>
            Outages aren't being followed.{" "}
            <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
              Choose your network
            </Link>
          </Note>
        ) : (
          <Note>Outages come from your electricity network. The Northern Territory's isn't supported yet.</Note>
        )}
      </Tile>
    );
  const list = [...view.now, ...view.planned.filter((o) => !view.now.some((x) => x.id === o.id))];
  const shown = all ? list : list.slice(0, SHOWN);
  const waiting = view.fetched_at == null;
  const here = list.find((o) => o.affects);
  const nearest = list.filter((o) => !o.affects).sort((a, b) => a.distance_km - b.distance_km)[0];
  const where = (o: Outage) => (o.affects === "street" ? "your street" : "your area");
  const note = view.error
    ? view.fetched_at
      ? `Couldn't reach ${view.networks.length > 1 ? "every network" : net.name}, so this is from ${hhmm(view.fetched_at)}.`
      : `Couldn't reach ${net.name}'s outage map. Check this machine's internet connection.`
    : waiting
      ? `Nothing from ${net.name}'s outage map yet. Outages within ${view.radius_km} km show here once it reports them.`
      : here
        ? here.planned && !(here.start != null && here.start <= now)
          ? `Planned work reaches ${where(here)}${planned(here, now)}. Charge your battery before it starts.`
          : `An outage reaches ${where(here)}${here.end ? `. Power's due back by ${hhmm(here.end)}` : ""}.`
        : nearest
          ? `The nearest is ${away(nearest).replace("Under 1 km away", "under 1 km away")}${view.street ? " and doesn't reach your street" : ""}.`
          : `Nothing within ${view.radius_km} km, and no planned work in the next two weeks.`;
  return (
    <Tile title="Outages nearby" aside={`${sources} · ${view.radius_km} km`}>
      {!waiting && (
        <div className="flex flex-col gap-2">
          {view.now.length === 0 && (
            <Line right={view.fetched_at ? `Checked ${hhmm(view.fetched_at)}` : undefined}>
              None near you right now
            </Line>
          )}
          {shown.map((o) => (
            <Line key={o.id} dot={o.planned ? PLANNED : UNPLANNED} right={shortWhen(o, now)} href={o.url}>
              {o.planned ? "Planned work" : "Outage"}
              {o.affects ? (
                <span className="text-warn"> {o.affects === "street" ? "on your street" : "in your area"}</span>
              ) : (
                <>
                  , {placeOf(o)}
                  <span className="text-ink-faint tabular-nums"> · {away(o)}</span>
                </>
              )}
            </Line>
          ))}
          {list.length > SHOWN && (
            <Button variant="muted-link" size="sm" onClick={() => setAll(!all)} className="self-start px-1">
              {all ? "Show fewer" : `Show all ${list.length}`}
            </Button>
          )}
        </div>
      )}
      <Note>
        {note}
        {!view.street && !waiting && (
          <>
            {" "}
            <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
              Add your street
            </Link>{" "}
            to see what reaches you.
          </>
        )}
      </Note>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------- voltage

/**
 * The grid's voltage at the house today: the range it's been through on a bar (within the standard's in green, out of
 * it in orange) with where it is now, its lowest and highest and when, and a sentence on what that means.
 */
export function VoltageToday({
  series,
  p,
  grid,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  grid: GridView | undefined;
}) {
  const lim = grid?.limits ?? { voltage_low: 216, voltage_high: 253, freq_low: 49.85, freq_high: 50.15, spike: 300 };
  const aside = `Normal ${lim.voltage_low}–${lim.voltage_high} V`;
  if (!series)
    return (
      <Tile title="Voltage today" aside={aside}>
        <Skeleton className="h-[92px] rounded-2xl" />
      </Tile>
    );
  const ts = series.t;
  const vs = series.grid_voltage ?? [];
  const read = ts
    .map((t, i) => ({ t, v: vs[i], w: series.grid_power?.[i] ?? null }))
    .filter((x) => x.v != null && x.v > 50) as {
    t: number;
    v: number;
    w: number | null;
  }[];
  const now = p?.grid_voltage != null && p.grid_voltage > 50 ? p.grid_voltage : (read[read.length - 1]?.v ?? null);
  const hz = p?.grid_freq != null && p.grid_freq > 0 ? p.grid_freq : null;
  if (!read.length && now == null)
    return (
      <Tile title="Voltage today" aside={aside}>
        <Note>Your inverter doesn't report the grid's voltage.</Note>
      </Tile>
    );
  const lo = read.length ? read.reduce((a, x) => (x.v < a.v ? x : a)) : null;
  const hi = read.length ? read.reduce((a, x) => (x.v > a.v ? x : a)) : null;
  const min = Math.min(lo?.v ?? now!, now!);
  const max = Math.max(hi?.v ?? now!, now!);
  const from = Math.min(lim.voltage_low, min) - 6;
  const to = Math.max(lim.voltage_high, max) + 6;
  const pc = (v: number) => `${(((v - from) / (to - from)) * 100).toFixed(1)}%`;
  const step = ts.length > 1 ? ts[1] - ts[0] : 300;
  const over = read.filter((x) => x.v > lim.voltage_high).length * step;
  const under = read.filter((x) => x.v < lim.voltage_low).length * step;
  const out = over > 0 || under > 0;
  const note =
    over > 0
      ? `Above ${lim.voltage_high} V for ${duration(over)} today, so your inverter may have held back exports.`
      : under > 0
        ? `Below ${lim.voltage_low} V for ${duration(under)} today. Big appliances can struggle when it's low.`
        : `Steady all day, within the standard's range.${hi?.w != null && hi.w < -ON ? " Your solar lifts it a little when you're sending power out." : ""}`;
  return (
    <Tile title="Voltage today" aside={aside}>
      <div className="relative mt-1 h-2 rounded-full bg-fg/8">
        <i
          aria-hidden
          className="absolute inset-y-0 rounded-full"
          style={{
            left: pc(min),
            width: `calc(${pc(max)} - ${pc(min)})`,
            minWidth: 4,
            background: out ? COLOR.export : COLOR.good,
            opacity: 0.7,
          }}
        />
        {now != null && (
          <b
            aria-label={`${Math.round(now)} V now`}
            className="absolute -top-[3px] h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: pc(now) }}
          />
        )}
      </div>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px] tabular-nums">
        {now != null && (
          <>
            <dt className="text-ink-muted">Now</dt>
            <dd className="m-0 text-right">{Math.round(now)} V</dd>
          </>
        )}
        {lo && (
          <>
            <dt className="text-ink-muted">Lowest</dt>
            <dd className="m-0 text-right">
              {Math.round(lo.v)} V at {hhmm(lo.t)}
            </dd>
          </>
        )}
        {hi && (
          <>
            <dt className="text-ink-muted">Highest</dt>
            <dd className="m-0 text-right">
              {Math.round(hi.v)} V at {hhmm(hi.t)}
            </dd>
          </>
        )}
        {hz != null && (
          <>
            <dt className="text-ink-muted">Frequency</dt>
            <dd className={cn("m-0 text-right", (hz > lim.freq_high || hz < lim.freq_low) && "text-warn")}>
              {hz.toFixed(2)} Hz
            </dd>
          </>
        )}
      </dl>
      <Note>{note}</Note>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------- warnings

/**
 * The Bureau's weather warnings and the Fire Department's fires for the house's area, as a short list, or that it's
 * all clear (and when each source last answered).
 */
export function WarningsNow({ view, now }: { view: HazardsView; now: number }) {
  const fires = view.fires.filter((f) => f.level !== "Information");
  const aside = view.fires_followed ? "Bureau · Fire Department" : "Bureau of Meteorology";
  if (!view.enabled)
    return (
      <Tile title="Warnings" aside={aside}>
        <Note>
          Weather and fire warnings are turned off.{" "}
          <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
            Turn them on
          </Link>
        </Note>
      </Tile>
    );
  if (!view.location_set)
    return (
      <Tile title="Warnings" aside={aside}>
        <LocationPrompt>Set your location to see weather and fire warnings for your area.</LocationPrompt>
      </Tile>
    );
  const serious = view.weather.some((w) => w.level === "warning") || fires.some((f) => f.level !== "Advice");
  const until = (t: number) => `Until ${sameDay(t, now) ? "" : `${weekdayShort.format(t * 1000)} `}${hhmm(t)}`;
  const bom = view.sources.bom;
  const qfd = view.sources.qfd;
  const failed = [bom?.error && "the Bureau", view.fires_followed && qfd?.error && "the Fire Department"].filter(
    Boolean,
  ) as string[];
  const checked = bom?.at ?? null;
  const none = !view.weather.length && !fires.length;
  return (
    <Tile title="Warnings" aside={aside}>
      <div className="flex flex-col gap-2">
        {none && <Line right={checked ? `Checked ${hhmm(checked)}` : undefined}>None for your area right now</Line>}
        {view.weather.map((w) => (
          <Line
            key={w.id}
            dot={w.level === "warning" ? COLOR.warn : COLOR.solar}
            right={w.expires ? until(w.expires) : undefined}
            href={w.url}
          >
            {w.headline || w.event}
          </Line>
        ))}
        {fires.map((f) => (
          <Line
            key={f.id}
            dot={
              f.level === "Emergency Warning" ? COLOR.danger : f.level === "Watch and Act" ? COLOR.warn : COLOR.solar
            }
            right={f.here ? "Your area" : `${f.distance_km} km ${f.direction ?? ""}`.trim()}
          >
            {f.level}: {f.area || "Area not given"}
          </Line>
        ))}
      </div>
      <Note>
        {failed.length
          ? `Couldn't reach ${listed(failed)} last time, so this may be out of date.`
          : none
            ? `All clear from the Bureau${view.fires_followed ? " and no fires within " + view.radius_km + " km" : ""}.`
            : serious
              ? "Keep your battery charged in case the power goes."
              : "Nothing urgent, but worth keeping an eye on."}
      </Note>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------- the outlook

/**
 * When the grid isn't normal, its own card across the page in the level's colour: what it means, the battery (how
 * long it would last at this use, and a way to charge it from the grid while there's still grid, when it's worth it),
 * and each reason.
 */
export function GridAlert({ grid, p, s }: { grid: GridView; p: Snapshot | null; s: SystemInfo | undefined }) {
  const { level, reasons } = grid.outlook;
  const l = LEVEL[level];
  const hasBattery = useHasBattery();
  const soc = p?.battery_soc;
  const cap = s?.battery_kwh;
  const load = p?.load_power;
  // What's left above the reserve, at what the house is using now.
  const left =
    soc != null && cap && load && load > ON ? ((Math.max(0, soc - reserveOf(s)) / 100) * cap * 1000) / load : null;
  const worried = level === "warning" || reasons.some((r) => r.kind === "storm");
  return (
    <Tile
      title={l.word}
      dot={l.color}
      aside={hasBattery && soc != null ? <span className="text-ink tabular-nums">Battery {pct(soc)}</span> : undefined}
      style={{
        borderColor: alpha(l.color, 0.35),
        backgroundColor: `color-mix(in oklab, ${l.color} 8%, color-mix(in oklab, var(--color-surface) 70%, transparent))`,
      }}
    >
      {reasons.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-2">
          {reasons.map((r, i) => (
            <Line key={`${r.kind}${i}`} dot={LEVEL[r.level].color} right={r.at ? hhmm(r.at) : undefined}>
              <span className="font-medium">{r.title}</span>
              <span className="text-ink-muted"> · {r.detail}</span>
            </Line>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Note className="text-ink">
          {l.sub}
          {left != null && (
            <span className="text-ink-muted"> Your battery would last about {duration(left * 3600)} at this use.</span>
          )}
        </Note>
        {hasBattery && worried && soc != null && soc < 95 && (
          <ButtonLink to="/battery" variant="primary" size="sm">
            Charge from the grid
          </ButtonLink>
        )}
      </div>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------------- how far around

/**
 * How far around the house outages and fires are looked for: one setting for both, saved as it's chosen. The
 * distances Manage → Integrations → Grid offers, plus whatever's set if it's another.
 */
export function RadiusPicker({ radius }: { radius: number }) {
  const save = useSaveSettings();
  const shown = save.isPending ? (save.variables?.outage_radius_km ?? radius) : radius;
  const options = [...new Set([...RADII, radius])].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="text-[13px] text-ink-muted">Outages and fires within</span>
      <Segmented
        label="How far around your house"
        value={String(shown)}
        onChange={(v) => save.mutate({ outage_radius_km: +v })}
        options={options.map((r) => ({ value: String(r), label: `${r} km` }))}
        className="max-sm:w-full"
        buttonClassName="px-3 py-[7px] text-[13px] max-sm:flex-1 max-sm:justify-center max-sm:px-1"
      />
    </div>
  );
}
