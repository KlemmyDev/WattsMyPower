import { useId, type ReactNode } from "react";
import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { batteryOutlook, type FullInfo } from "~/features/overview/utils/batteryOutlook";
import { batteryState, reserveOf, type BatteryState } from "~/features/common/energy/utils";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import { ARC_LARGE, BatteryArc } from "~/features/overview/components/BatteryArc";
import { BatteryHistory } from "~/features/overview/components/BatteryHistory";
import { BatteryPower } from "~/features/overview/components/BatteryPower";
import { BatteryModeLine } from "~/features/battery/components/BatteryModeLine";
import { useBatteryMode } from "~/features/battery/hooks";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";

/** The ring at its largest (px). */
const RING = 168;
/** The header's height (the mode pill's) and the gap under it, and the outlook's under a ring (px). */
const HEAD = 34 + 12;
const UNDER = 52 + 12;

/** The figures behind the ring, in the order they're shown (as many as there's room for). */
export const BATTERY_FACTS = [
  { key: "usable", label: "Usable now", sub: "What it can still give above its reserve" },
  { key: "charged", label: "Charged today" },
  { key: "used", label: "Used today" },
  { key: "reserve", label: "Reserve", sub: "What it keeps for a blackout" },
  { key: "health", label: "Health", sub: "Where the inverter reports it" },
  { key: "temp", label: "Temperature", sub: "Where the inverter reports it" },
] as const;
export type BatteryFact = (typeof BATTERY_FACTS)[number]["key"];

/** How far back its chart goes: as far as its size suits (6 hours, or 12 at the whole width), or set. */
export const BATTERY_HOURS = [
  { value: "auto", label: "To suit its size" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
];

/** What the card shows, given room for it. */
export type BatteryShow = {
  outlook: boolean;
  mode: boolean;
  shortcuts: boolean;
  kwh: boolean;
  chart: boolean;
  hours: "auto" | "6" | "12" | "24";
  facts: BatteryFact[];
};

/** A widget's settings as what it shows: everything on, unless switched off. */
export function batteryShow(settings: Settings): BatteryShow {
  const hours = BATTERY_HOURS.find((o) => o.value === settings.hours)?.value ?? "auto";
  return {
    outlook: settings.outlook !== false,
    mode: settings.mode !== false,
    shortcuts: settings.shortcuts !== false,
    kwh: settings.kwh !== false,
    chart: settings.chart !== false,
    hours: hours as BatteryShow["hours"],
    facts: BATTERY_FACTS.filter((x) => settings[x.key] !== false).map((x) => x.key),
  };
}
const ALL = batteryShow({});

/**
 * The most rows the card can use at `w` columns for what it shows: with its chart, any (the chart takes what's left);
 * without, the header and ring, and the figures under them where they go under (5 to 7 columns).
 */
export function batteryRows(show: BatteryShow, w: number) {
  if (show.chart) return undefined;
  return rowsFor(HEAD + RING + (w <= 2 ? UNDER : 0) + (show.facts.length && w >= 3 && w <= 7 ? 12 + 58 : 0));
}

/**
 * The battery's state of charge ring, time to full (or to reserve), what it's set to do, and the last six hours, fitted
 * to its size on the grid (`w` columns by `h` rows) rather than stretched to it. At its smallest (2 × 2) it's the ring
 * alone, with the charge and what it's doing in it. Wider, the outlook comes in beside it; taller, a header with what
 * it's set to do (and the shortcuts, given room), then the last six hours (beside it in a short wide one, under it in a
 * tall one). Larger still, the figures behind it: what it can still give, what went in and out today, its reserve,
 * health and temperature. `show` leaves any of it out (and what's left takes the room).
 */
export function BatteryCard({
  p,
  s,
  f,
  now,
  w = 6,
  h = 7,
  title = "Battery",
  show = ALL,
  className,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  /** Its size on the grid, in columns and rows. */
  w?: number;
  h?: number;
  title?: string;
  show?: BatteryShow;
  className?: string;
}) {
  const id = useId();
  const st = batteryState(p?.battery_power);
  const mode = useBatteryMode();
  const fi = p ? batteryOutlook(p, s, f, now, mode) : null;
  const { wide, tall, inner } = roomOf(w, h);
  const xs = wide === "xs";
  // The ring alone at the smallest; over its outlook where it's narrow; beside it otherwise.
  const alone = (xs && tall === "short") || !show.outlook;
  const stacked = xs || (w === 3 && h >= 4);
  const header = tall !== "short" && !(xs && tall === "mid");
  const big = tall === "tall" && (wide === "md" || wide === "lg");
  const pill = show.mode && !xs;
  const keys = show.shortcuts && (big || w >= 5);
  const chart = !show.chart ? null : tall === "tall" ? "under" : w >= 7 ? "side" : null;
  const hours = show.hours === "auto" ? (wide === "lg" ? 12 : 6) : Number(show.hours);
  const figures = figuresOf(p, s, show.facts);
  const facts =
    figures.length > 0 &&
    (tall === "short"
      ? w >= 10 && { side: true, n: 2, cols: 2 }
      : tall === "mid"
        ? w >= (show.chart ? 10 : 8) && { side: true, n: 4, cols: 2 }
        : wide === "lg"
          ? { side: true, n: w >= 10 ? 6 : 4, cols: w >= 10 ? 3 : 2 }
          : wide === "md"
            ? h >= (show.chart ? 7 : 5) && { side: false, n: w >= 6 ? 4 : 3, cols: w >= 6 ? 4 : 3 }
            : w === 4 && h >= (show.chart ? 8 : 5) && { side: false, n: 2, cols: 2 });
  const under = facts && !facts.side;
  // The height the ring has: the card's, less the header and the outlook under it; tall, it shares it with the chart.
  const room = inner - (header ? HEAD : 0) - (stacked && !alone ? UNDER : 0);
  const ring = Math.max(72, Math.min(RING, chart === "under" && stacked ? room / 2 : room));
  return (
    <Card
      aria-labelledby={id}
      className={cn("@container relative h-full gap-3 overflow-hidden p-5 max-sm:p-4", className)}
    >
      {header ? (
        big ? (
          <CardHeader
            title={title}
            id={id}
            className="h-[34px]"
            action={
              pill && (
                <BatteryModeLine now={now} shortcuts={keys} className={cn("min-w-0 rounded-full", !keys && "pr-3.5")} />
              )
            }
          />
        ) : (
          <div className="flex h-[34px] min-w-0 items-center gap-3">
            <span id={id} className="flex-none truncate font-display text-base font-bold">
              {title}
            </span>
            {pill && (
              <BatteryModeLine
                now={now}
                shortcuts={keys}
                className={cn("ml-auto min-w-0 rounded-full", !keys && "pr-3.5")}
              />
            )}
          </div>
        )
      ) : (
        <span id={id} className="sr-only">
          {title}
        </span>
      )}
      <div
        className={cn(
          "relative z-1 flex min-h-0 min-w-0",
          stacked ? "flex-col items-center justify-center gap-3" : "items-center gap-5",
          alone && "justify-center",
          // under the header it stays at the top; with the chart beside it, or no header (a short row), it takes
          // the card's height, the ring and outlook in its middle
          chart === "side" || !header ? "flex-1" : "flex-none",
        )}
      >
        <Ring p={p} s={s} st={st} px={ring} cap={stacked ? 100 : 46} kwh={show.kwh} />
        {!alone && fi && (
          <Outlook
            fi={fi}
            warn={st === "discharge"}
            center={stacked}
            large={big}
            lines={stacked ? 0 : tall === "short" ? 2 : tall === "mid" ? 3 : 4}
            className={chart === "side" || facts ? "max-w-[17rem]" : undefined}
          />
        )}
        {facts && facts.side && (
          <Facts
            items={figures}
            n={facts.n}
            cols={facts.cols}
            className={chart === "side" ? "w-[15rem] flex-none" : "ml-auto max-w-[30rem] min-w-[14rem] flex-1"}
          />
        )}
        {chart === "side" && (
          <BatteryHistory
            end={p ? p.ts + 1 : null}
            s={s}
            hours={hours}
            className="mt-0 h-auto min-w-0 flex-1 self-stretch"
          />
        )}
      </div>
      {under && <Facts items={figures} n={facts.n} cols={facts.cols} />}
      {chart === "under" && (
        // edge to edge along the bottom, its labels padded in, taking what height is left
        <BatteryHistory
          end={p ? p.ts + 1 : null}
          s={s}
          hours={hours}
          className="-mx-5 -mb-5 h-auto min-h-0 flex-1 max-sm:-mx-4 max-sm:-mb-4"
          inset="px-5 max-sm:px-4"
        />
      )}
    </Card>
  );
}

/**
 * What it'll do next: the time to full (or to reserve, or what it's set to), with a sentence on it given `lines`.
 * Where its column's narrow, the eyebrow and headline say it in a word or two, and the sentence is left out.
 */
function Outlook({
  fi,
  warn,
  center,
  large,
  lines,
  className,
}: {
  fi: FullInfo;
  warn: boolean;
  center: boolean;
  large: boolean;
  /** How many lines its sentence may take (2 to 4); with none, it's left out. */
  lines: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container flex min-w-0 flex-col gap-1",
        center ? "w-full items-center text-center" : "flex-1",
        className,
      )}
    >
      {/* keyed, so a change (to full, to reserve, on standby…) fades in rather than snapping */}
      <span
        key={fi.eyebrow}
        className={cn(
          "w-full animate-fade truncate text-[13px] leading-5 font-medium",
          warn ? "text-warn" : "text-ink-muted",
        )}
      >
        <span className="@max-[13rem]:hidden">{fi.eyebrow}</span>
        <span className="@min-[13rem]:hidden">{fi.tag}</span>
      </span>
      <span
        key={fi.headline}
        title={fi.headline}
        className={cn(
          "w-full animate-fade truncate font-light tracking-[-0.03em] tabular-nums",
          center
            ? "text-xl leading-7"
            : large
              ? "text-[26px] leading-8 @min-[13rem]:text-[34px] @min-[13rem]:leading-10"
              : "text-[22px] leading-7 @min-[15rem]:text-[28px] @min-[15rem]:leading-9",
          warn && "text-warn",
        )}
      >
        <span className="@max-[13rem]:hidden">{fi.headline}</span>
        <span className="@min-[13rem]:hidden">{fi.brief}</span>
      </span>
      {lines > 0 && fi.detail.trim() && (
        <p
          title={fi.detail}
          className={cn(
            "m-0 text-[13px] leading-5 text-pretty text-ink-muted @max-[13rem]:hidden",
            lines > 3 ? "line-clamp-4" : lines > 2 ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {fi.detail}
        </p>
      )}
    </div>
  );
}

/**
 * The battery's ring (see BatteryArc), `px` across at most and no more than `cap` % of the card's width, with the
 * charge in the middle gliding to each reading, what it holds (given room and `kwh`), and what it's doing; the dark dot
 * marks the backup reserve. What's in it scales with it.
 */
function Ring({
  p,
  s,
  st,
  px,
  cap,
  kwh: showKwh,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  st: BatteryState | null;
  px: number;
  cap: number;
  kwh: boolean;
}) {
  const kwh = s?.battery_kwh || 0;
  const soc = p?.battery_soc ?? null;
  const shown = useTween(soc);
  const reserve = reserveOf(s) / 100;
  return (
    <div
      className="@container relative aspect-square flex-none"
      style={{ width: `min(${Math.round(px)}px, ${cap}cqw)` }}
      title={`Backup reserve ${pct(reserve * 100)}`}
    >
      {p && (
        <>
          <BatteryArc frac={(soc || 0) / 100} st={st} size={ARC_LARGE} reserve={reserve} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2.5cqw] pt-[1.5cqw]">
            <div className="text-[31cqw] leading-none font-light tracking-[-0.06em] tabular-nums">
              {shown == null ? "—" : Math.round(shown)}
              <span className="ml-0.5 text-[13cqw] font-normal tracking-normal text-ink-muted">%</span>
            </div>
            {showKwh && kwh > 0 && soc != null && (
              <div className="text-xs font-medium text-ink-muted tabular-nums @max-[8.5rem]:hidden">
                {((soc / 100) * kwh).toFixed(1)} of {kwh} kWh
              </div>
            )}
            <BatteryPower st={st} w={p.battery_power} className="@max-[6.5rem]:text-[11px]" />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The figures `shown` that are known: what it can still give above its reserve, what went in and out today, the
 * reserve, and its health and temperature where the inverter reports them.
 */
function figuresOf(p: Snapshot | null, s: SystemInfo | undefined, shown: BatteryFact[]): [string, ReactNode][] {
  const cap = s?.battery_kwh;
  const soc = p?.battery_soc;
  const reserve = reserveOf(s);
  const value: Record<BatteryFact, ReactNode | null> = {
    usable: soc != null && cap ? kWh(Math.max(0, ((soc - reserve) / 100) * cap)) : DASH,
    charged: kWh(p?.daily_charge),
    used: kWh(p?.daily_discharge),
    reserve: pct(reserve),
    health: p?.battery_soh != null ? pct(p.battery_soh) : null,
    temp: p?.battery_temp != null ? `${Math.round(p.battery_temp)}°C` : null,
  };
  return BATTERY_FACTS.filter((x) => shown.includes(x.key) && value[x.key] != null).map((x) => [x.label, value[x.key]]);
}

/** Figures, as many as `n`, `cols` to a row (fewer, if there are fewer of them). */
function Facts({
  items,
  n,
  cols,
  className,
}: {
  items: [string, ReactNode][];
  n: number;
  cols: number;
  className?: string;
}) {
  const shown = items.slice(0, n);
  return (
    <div
      className={cn("grid min-w-0 gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${Math.min(cols, shown.length)}, minmax(0, 1fr))` }}
    >
      {shown.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-fg/4 px-3 py-2">
          <span className="truncate text-[11.5px] leading-4 text-ink-muted">{label}</span>
          <span className="truncate text-[17px] leading-6 font-light tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}
