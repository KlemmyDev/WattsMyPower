import { useState, type CSSProperties, type PointerEvent } from "react";
import { hourLabel, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, hourOf, mondayFirst, nowS, partsOf } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { ChartTooltip, HoverLine, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { cn } from "~/features/common/ui/utils";
import type { HomeUsage } from "~/features/home/types";
import { CAR_COLOR, CAR_ID, OTHER_COLOR, WEEKDAY_SHORT, type Range } from "~/features/home/utils";

export type { Range };
export const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];

/** The Home page's periods: a day (by the hour, any day), or the last 7 or 30 days. */
const HOME_RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Day" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];

/** What's being compared with, drawn dashed: the day or period before's line. */
const THEN = alpha(COLOR.fg, 0.5);

/** A part's share of the whole, as a percentage: "<1%" for a little, rather than "0%". */
const share = (part: number, whole: number | null) =>
  whole ? (part > 0 && part / whole < 0.005 ? "<1%" : `${Math.round((part / whole) * 100)}%`) : null;

/** A round top for the chart. */
function niceMax(v: number) {
  const step = v > 20 ? 5 : v > 5 ? 1 : v > 1 ? 0.5 : 0.1;
  return Math.max(step, Math.ceil(v / step) * step);
}

function bucketLabel(t: number, bucket: "hour" | "day") {
  const h = hourOf(t);
  return bucket === "hour" ? `${hourLabel(h)}–${hourLabel((h + 1) % 24)}` : shortDay.format(t * 1000);
}

/** Every few bars gets an axis label: each hour's 3rd, each day for a week, every 5th day for a month. */
function axisLabel(t: number, i: number, n: number, bucket: "hour" | "day") {
  const d = partsOf(t);
  if (bucket === "hour") return d.hour % 6 === 0 ? hourLabel(d.hour) : null;
  if (n <= 8) return WEEKDAY_SHORT[mondayFirst(t)];
  return i % 5 === 0 || i === n - 1 ? String(d.day) : null;
}

/** "a, b and c". */
const listed = (parts: string[]) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * What the period cost, in a line: the biggest devices' parts of it, everything else, and the supply charges. "Your
 * home cost $4.25 today: the Dryer $1.10, the Fridge $0.60, everything else $1.50 and $1.05 in supply charges."
 */
function costLine(usage: HomeUsage, devices: HomeUsage["devices"], rangeWords: string) {
  const c = usage.total.cost;
  if (c.import < 0.01)
    return `Nice, everything your home used ${rangeWords} came from your panels and battery. The ${money(c.supply)} it cost was just supply charges.`;
  const charged = usage.car && usage.car.cost >= 0.01 ? [{ name: "the car", cost: usage.car.cost }] : [];
  const top = [...devices, ...charged].filter((d) => d.cost >= 0.01).sort((a, b) => b.cost - a.cost);
  const named = top.slice(0, 3).map((d) => `${d.name} ${money(d.cost)}`);
  if (top.length > 3) named.push(`your other devices ${money(top.slice(3).reduce((a, d) => a + d.cost, 0))}`);
  const parts = [...named, `everything else ${money(c.other)}`];
  const split = listed(parts);
  return `Your home cost ${money(c.import + c.supply)} ${rangeWords}. ${split.charAt(0).toUpperCase()}${split.slice(1)}, plus ${money(c.supply)} in supply charges.`;
}

/** One part of the home's use, hour by hour or day by day: a device, the car, or everything else. */
type Part = { id: number; label: string; color: string; kwh: (number | null)[] };

/** A part's lane: its use through the period, its total, what it cost, and its share of the home's. */
type LanePart = Part & { total: number; cost: number };

/** The label column beside the charts (hidden on phones, where each lane's label sits over it). */
const LABEL = "w-56 flex-none max-sm:hidden";

/**
 * Where the home's power went: everything the home used and what it cost, then the home's use over the period as a
 * line (the period before dashed over it, when compared), and under it, on the same hours or days, a lane each for
 * what each device, the car and everything else used. Each lane is scaled to its own busiest hour or day, so a lamp's
 * evening shows as plainly as the car's charge; its top is in the gutter, and its total and share beside it.
 */
export function UsageCard({
  usage,
  colors,
  range,
  rangeWords,
  onRange,
  day,
  today,
  onDay,
  compare,
  onCompare,
  previous,
  previousWords,
  loading = false,
}: {
  usage: HomeUsage | undefined;
  colors: Map<number, string>;
  range: Range;
  /** The period in words, for the cost line: "today", "on Mon 6 Oct", "in 7 days". */
  rangeWords: string;
  onRange: (r: Range) => void;
  /** The day shown by the hour (local midnight), today's, and moving to another. */
  day: number;
  today: number;
  onDay: (day: number) => void;
  /** The period before is drawn over this one, dashed (`previous`, once it's loaded). */
  compare: boolean;
  onCompare: (on: boolean) => void;
  previous: HomeUsage | undefined;
  /** What it's compared with, in words: "yesterday", "the 7 days before". */
  previousWords: string;
  /** The next day or period is loading: what's shown is the last one's, dimmed until it arrives. */
  loading?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0); // the plots' width in layout px, as the tooltip is placed in
  const devices = (usage?.devices ?? []).filter((d) => colors.has(d.id));
  const total = usage?.total;
  const whole = total?.home ?? null;
  // The comparison's line has its place kept whether it's shown or not, so turning it on doesn't move the card; it
  // fades in, and out with the words it had.
  const compared = compare && previous && usage ? comparedText(usage, previous, previousWords) : null;
  const [lastCompared, setLastCompared] = useState(compared);
  if (compared && compared !== lastCompared) setLastCompared(compared);

  // Every device each hour or day, shown or not, so one shown or hidden eases rather than appearing from nowhere.
  const stack: Part[] = usage
    ? [
        ...devices.map((d) => ({ id: d.id, label: d.name, color: colors.get(d.id)!, kwh: d.kwh })),
        ...(usage.car ? [{ id: CAR_ID, label: "Car charging", color: CAR_COLOR, kwh: usage.car.kwh }] : []),
      ]
    : [];
  // The lanes: what used anything, the most first, then everything else (what's left of the home's line).
  const lanes: LanePart[] = usage
    ? [
        ...[
          ...devices.map((d) => ({ ...stack.find((p) => p.id === d.id)!, total: d.total, cost: d.cost })),
          ...(usage.car && usage.car.total > 0
            ? [{ ...stack.find((p) => p.id === CAR_ID)!, total: usage.car.total, cost: usage.car.cost }]
            : []),
        ]
          .filter((p) => p.total >= 0.0005)
          .sort((a, b) => b.total - a.total),
        ...(total?.other != null && total.other >= 0.0005
          ? [
              {
                id: 0,
                label: "Everything else",
                color: OTHER_COLOR,
                kwh: usage.other,
                total: total.other,
                cost: total.cost.other,
              },
            ]
          : []),
      ]
    : [];
  const unused = devices.filter((d) => d.total < 0.0005).map((d) => d.name);
  const n = usage?.t.length ?? 0;
  // The last hour with readings (or with a device's, before the inverter's arrive); a period of days, its last day.
  const last = !usage
    ? -1
    : usage.bucket === "day"
      ? n - 1
      : Math.max(
          usage.home.findLastIndex((v) => v != null),
          ...stack.map((p) => p.kwh.findLastIndex((v) => (v ?? 0) > 0)),
        );
  const shownBefore = compare ? previous : undefined;
  // Either chart, pointed at, picks the hour or day under the pointer for both (past the last hour, the last, unless
  // the day before is drawn there).
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth);
    const i = Math.floor(Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * n);
    setHover(i <= last || (shownBefore && i < shownBefore.t.length) ? i : last >= 0 ? last : null);
  };
  const plot = { onPointerMove: point, onPointerDown: point, onPointerLeave: () => setHover(null) };

  return (
    <Card aria-labelledby="h-usage" className="col-span-12 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-usage">Where your power went</h2>
          <span className="text-[13px] text-ink-muted">
            Your home's total from the inverter, and each connected device's share
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {range === "today" && (
            <div className="flex items-center gap-1">
              <Button variant="icon" aria-label="The day before" onClick={() => onDay(addDays(day, -1))}>
                <Icon name="chevL" size={16} />
              </Button>
              <span className="min-w-[92px] text-center text-sm font-medium tabular-nums">
                {day === today
                  ? "Today"
                  : day === addDays(today, -1)
                    ? "Yesterday"
                    : shortDay.format(new Date(day * 1000))}
              </span>
              <Button
                variant="icon"
                aria-label="The day after"
                disabled={day >= today}
                onClick={() => onDay(addDays(day, 1))}
                className="disabled:opacity-40"
              >
                <Icon name="chevR" size={16} />
              </Button>
            </div>
          )}
          <Segmented label="Period" options={HOME_RANGES} value={range} onChange={onRange} />
        </div>
      </div>

      {!usage ? (
        <Skeleton className="h-[360px]" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Used at home</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">
                <Tweened value={whole} format={kWh} />
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Cost</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">
                <Tweened value={usage.total.cost.import + usage.total.cost.supply} format={money} />
              </span>
            </div>
            <div className="flex flex-col gap-1 pb-1.5 text-sm text-ink-muted tabular-nums">
              <span>
                <b className="font-semibold text-ink">{kWh(total?.measured ?? 0)}</b> measured by your devices
                {usage.car?.total ? " and car" : ""}
                {whole ? ` (${share(total?.measured ?? 0, whole)})` : ""}
              </span>
              {usage.total.cost.credit > 0 && <span>{money(usage.total.cost.credit)} earned from feed-in</span>}
              {whole == null && (
                <span>No inverter readings for this period, so this is only what your devices measured</span>
              )}
              <span
                aria-hidden={!compared}
                className={cn("truncate transition-opacity duration-300", compared ? "opacity-100" : "opacity-0")}
              >
                {compared ?? lastCompared ?? " "}
              </span>
            </div>
          </div>
          {usage.total.cost.import + usage.total.cost.supply > 0 && (
            <p className="m-0 -mt-2 text-sm text-pretty text-ink-muted">{costLine(usage, devices, rangeWords)}</p>
          )}

          <div className="-mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-faint">
              {usage.bucket === "hour" ? "Hour by hour" : "Day by day"}
              {compare && previous ? `, with ${previousWords} dashed` : ""}
            </span>
            <button
              type="button"
              aria-pressed={compare}
              onClick={() => onCompare(!compare)}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 rounded-full border bg-transparent px-3 font-sans text-[13px] transition-colors duration-150",
                compare ? "border-fg/25 bg-fg/7 text-ink" : "border-line text-ink-muted hover:text-ink",
              )}
            >
              <span
                aria-hidden
                className="w-4 border-t-2 border-dashed"
                style={{ borderColor: compare ? COLOR.ink : THEN }}
              />
              Compare with {previousWords}
            </button>
          </div>
          {/* Keyed by the period, so a new day or period draws in, while hiding a part or comparing eases what's
              there. While the next one loads, the last stays, dimmed. */}
          <div
            key={`${usage.start}:${usage.end}`}
            className={cn("flex flex-col gap-2 transition-opacity duration-300", loading && "opacity-50")}
          >
            <div className="flex gap-4">
              <div className={cn(LABEL, "flex flex-col gap-1.5 pt-0.5 text-xs text-ink-muted")}>
                <span className="flex items-center gap-2">
                  <i aria-hidden className="h-0.5 w-3.5 flex-none rounded-full" style={{ background: COLOR.ink }} />
                  Your home
                </span>
                {shownBefore && (
                  <span className="flex animate-fade items-center gap-2 first-letter:uppercase">
                    <i aria-hidden className="w-3.5 flex-none border-t-2 border-dashed" style={{ borderColor: THEN }} />
                    {previousWords.charAt(0).toUpperCase() + previousWords.slice(1)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Trend
                  usage={usage}
                  stack={stack}
                  last={last}
                  previous={shownBefore}
                  previousWords={previousWords}
                  hover={hover}
                  width={width}
                  plot={plot}
                />
              </div>
            </div>
            {lanes.length > 0 && (
              <div className="mt-2 flex flex-col gap-2.5 max-sm:gap-3">
                {lanes.map((p, k) => (
                  <Lane key={p.id} part={p} usage={usage} last={last} whole={whole} hover={hover} plot={plot} i={k} />
                ))}
              </div>
            )}
            <div className="flex gap-4">
              <div className={LABEL} />
              <div className="flex min-w-0 flex-1 pr-12 font-mono text-[10px] text-ink-faint max-sm:pr-10">
                {usage.t.map((t, i) => (
                  <span key={t} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
                    {axisLabel(t, i, n, usage.bucket) ?? ""}
                  </span>
                ))}
              </div>
            </div>
            {unused.length > 0 && (
              <p className="m-0 text-xs text-pretty text-ink-faint">
                {listed(unused)} didn't use anything {rangeWords}.
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

type Plot = {
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
};

/** A chart's two grid lines, at its top and half way, labelled in the gutter on the right. */
function Grid({ top }: { top: number }) {
  return (
    <>
      {[1, 0.5].map((q) => (
        <div
          key={q}
          className="pointer-events-none absolute inset-x-0 border-t border-fg/5"
          style={{ top: `${(1 - q) * 100}%` }}
        >
          <span className="absolute -top-[7px] right-0 font-mono text-[10px] leading-[14px] text-ink-faint">
            {kWh(top * q)}
          </span>
        </div>
      ))}
    </>
  );
}

/** A lane's top: its busiest hour or day, but never under 10 Wh, so a device that barely draws anything doesn't fill
 * its lane with noise. */
const laneTop = (v: number) => Math.max(v, 0.01);

/**
 * One part's lane: its name, total and share of the home's beside it, and its use each hour or day as bars scaled to
 * its own busiest (what that was in the gutter, at the top). Pointing at it picks that hour or day across the card, as the line does.
 */
function Lane({
  part: p,
  usage,
  last,
  whole,
  hover,
  plot,
  i,
}: {
  part: LanePart;
  usage: HomeUsage;
  last: number;
  whole: number | null;
  hover: number | null;
  plot: Plot;
  /** Its place in the list, for the bars' stagger as they grow in. */
  i: number;
}) {
  const v = (k: number) => (k <= last ? Math.max(0, p.kwh[k] ?? 0) : 0);
  const top = laneTop(Math.max(0, ...usage.t.map((_, k) => v(k))));
  const busiest = usage.t.reduce((a, _, k) => (v(k) > v(a) ? k : a), 0);
  const of = share(p.total, whole);
  const said = [
    `${p.label}: ${kWh(p.total)}`,
    of ? `${of} of your home's use` : null,
    p.cost >= 0.005 ? money(p.cost) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const label = (
    <>
      <span className="size-2 flex-none rounded-full" style={{ background: p.color }} />
      <span className="min-w-0 truncate text-ink-muted">{p.label}</span>
      <span className="ml-auto font-semibold whitespace-nowrap text-ink">
        <Tweened value={p.total} format={kWh} />
      </span>
      <span className="w-8 flex-none text-right text-xs text-ink-faint">{of ?? ""}</span>
    </>
  );
  return (
    <div className="flex items-center gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
      <div
        className="flex w-56 flex-none items-center gap-2 text-[13px] tabular-nums max-sm:w-auto"
        title={p.cost >= 0.005 ? `${money(p.cost)} ${p.id === 0 ? "for everything else" : "of the cost"}` : undefined}
      >
        {label}
      </div>
      <div className="relative h-7 min-w-0 flex-1 pr-12 max-sm:flex-none max-sm:pr-10">
        <span className="pointer-events-none absolute -top-[3px] right-0 font-mono text-[10px] leading-[14px] text-ink-faint">
          {kWh(top)}
        </span>
        <div
          role="img"
          aria-label={`${said}. Most ${kWh(v(busiest))}, ${bucketLabel(usage.t[busiest], usage.bucket)}`}
          className="relative flex h-full cursor-crosshair touch-pan-y items-end border-b border-fg/8"
          {...plot}
        >
          {usage.t.map((t, k) => (
            <span
              key={t}
              className={cn(
                "bar-grow flex h-full min-w-0 flex-1 items-end transition-opacity duration-150",
                // a week's seven wide bars kept apart, a day's or a month's narrow ones close
                usage.t.length <= 10 ? "px-1.5 max-sm:px-1" : "px-[1.5px] max-sm:px-px",
                hover != null && hover !== k && "opacity-40",
              )}
              style={{ "--i": k + i * 2 } as CSSProperties}
            >
              <span
                className="w-full rounded-t-[2px] transition-[height] duration-500 ease-out-soft"
                style={{
                  height: v(k) > 0 ? `max(1.5px, ${(v(k) / top) * 100}%)` : 0,
                  background: p.color,
                }}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The home's use against the period before's, in words. A day still going is compared up to the same hour. */
function comparedText(usage: HomeUsage, previous: HomeUsage, words: string): string | null {
  const going = usage.bucket === "hour" && usage.end > nowS();
  const n = going ? usage.home.findLastIndex((v) => v != null) + 1 : usage.t.length;
  const sum = (u: HomeUsage) => u.home.slice(0, n).reduce<number>((a, v) => a + (v ?? 0), 0);
  const now = sum(usage);
  const then = sum(previous);
  if (n <= 0 || then < 0.05) return null;
  const change = (now - then) / then;
  const said =
    Math.abs(change) < 0.05
      ? `About the same as ${words}`
      : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more" : "less"} than ${words}`;
  return going ? `${said} by this time` : said;
}

/** A figure that glides to each new value (a part shown or hidden, another day). */
function Tweened({ value, format }: { value: number | null; format: (v: number) => string }) {
  const v = useTween(value, 500);
  return <>{v == null ? "—" : format(v)}</>;
}

/** A line through the points, curved but never past a reading (monotone cubic, Fritsch–Carlson). */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]} ${pts[0][1]}` : "";
  const dx: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    s.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m = pts.map((_, i) =>
    i === 0 ? s[0] : i === n - 1 ? s[n - 2] : s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2,
  );
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s[i];
    const b = m[i + 1] / s[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      m[i] = k * a * s[i];
      m[i + 1] = k * b * s[i];
    }
  }
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const c = dx[i] / 3;
    d += ` C${f(x0 + c)} ${f(y0 + m[i] * c)} ${f(x1 - c)} ${f(y1 - m[i + 1] * c)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

const LW = 1000;
const LH = 180;
/** A path's shape as a style too, so a browser that can (not Safari, yet) eases it to a new one (see .chart-ease). */
const shape = (d: string) => ({ d: `path("${d}")` }) as CSSProperties;

const LINE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/**
 * What the home used over the period, as one line over a soft area (without inverter readings, what was measured),
 * and the period before's dashed when compared. Each point sits mid-hour or mid-day, over its bar below; a day still
 * going stops at its last hour with readings. The hour or day under the pointer is summed up in a tooltip, with each
 * part shown.
 */
function Trend({
  usage,
  stack,
  last,
  previous,
  previousWords,
  hover: h,
  width,
  plot,
}: {
  usage: HomeUsage;
  stack: Part[];
  /** The last hour or day with readings. */
  last: number;
  previous?: HomeUsage;
  previousWords: string;
  hover: number | null;
  width: number;
  plot: Plot;
}) {
  const n = usage.t.length;
  const upto = Array.from({ length: Math.max(0, last + 1) }, (_, i) => i);
  const all = Array.from({ length: n }, (_, i) => i);
  const read = upto.filter((i) => usage.home[i] != null);
  const measured = (i: number) => stack.reduce((a, p) => a + (p.kwh[i] ?? 0), 0);
  const now = (i: number): number | null => (read.length > 1 ? (usage.home[i] ?? null) : measured(i));
  const then = (i: number) => (previous && i < previous.t.length ? (previous.home[i] ?? null) : null);
  const top = niceMax(Math.max(0, ...upto.map((i) => now(i) ?? 0), ...all.map((i) => then(i) ?? 0)));
  const X = (i: number) => ((i + 0.5) / n) * LW;
  const Y = (v: number) => LH - (Math.max(0, v) / top) * (LH - 6);
  const pts = (idx: number[], v: (i: number) => number | null) =>
    idx.filter((i) => v(i) != null).map((i): [number, number] => [X(i), Y(v(i)!)]);
  const main = pts(read.length > 1 ? read : upto, now);
  const before = previous ? pts(all, then) : [];
  const mainD = smooth(main);
  const beforeD = smooth(before);
  const area =
    main.length > 1 ? `${mainD} L${main[main.length - 1][0].toFixed(1)} ${LH} L${main[0][0].toFixed(1)} ${LH} Z` : "";
  const pc = (v: number) => (Y(v) / LH) * 100;
  const parts = h != null && h <= last ? stack.filter((p) => (p.kwh[h] ?? 0) > 0) : [];
  const other = h != null && h <= last ? (usage.other[h] ?? null) : null;
  const capital = previousWords.charAt(0).toUpperCase() + previousWords.slice(1);

  return (
    <div className="relative h-[180px] pr-12 max-sm:h-[150px] max-sm:pr-10">
      <Grid top={top} />
      <div className="absolute inset-y-0 right-12 left-0 border-b border-fg/8 max-sm:right-10" />
      <div
        role="img"
        aria-label={`What your home used ${usage.bucket === "hour" ? "hour by hour" : "day by day"}${previous ? `, with ${previousWords} dashed` : ""}`}
        className="relative h-full cursor-crosshair touch-pan-y"
        {...plot}
      >
        {/* The line eases to its new shape; the period draws in from the left when it opens, and the one before
            when it's compared. */}
        <div className="absolute inset-0 animate-reveal-x">
          <svg
            viewBox={`0 0 ${LW} ${LH}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <defs>
              <linearGradient id="usage-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--color-ink)" stopOpacity="0.14" />
                <stop offset="1" stopColor="var(--color-ink)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {area && <path d={area} className="chart-ease" style={{ fill: "url(#usage-area)", ...shape(area) }} />}
            {main.length > 1 && (
              <path
                d={mainD}
                {...LINE}
                className="chart-ease"
                style={{ stroke: COLOR.ink, ...shape(mainD) }}
                strokeWidth={2.4}
              />
            )}
          </svg>
        </div>
        {before.length > 1 && previous && (
          <div key={previous.start} className="pointer-events-none absolute inset-0 animate-reveal-x">
            <svg
              viewBox={`0 0 ${LW} ${LH}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              <path
                d={beforeD}
                {...LINE}
                className="chart-ease"
                style={{ stroke: THEN, ...shape(beforeD) }}
                strokeWidth={1.6}
                strokeDasharray="5 5"
              />
            </svg>
          </div>
        )}
        {h != null && (
          <>
            <HoverLine left={((h + 0.5) / n) * 100} />
            {[
              ...(then(h) != null ? [{ key: "then", v: then(h)!, color: THEN }] : []),
              ...(h <= last && now(h) != null ? [{ key: "now", v: now(h)!, color: COLOR.ink }] : []),
            ].map((dot) => (
              <span
                key={dot.key}
                className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
                style={{ left: `${((h + 0.5) / n) * 100}%`, top: `${pc(dot.v)}%`, background: dot.color }}
              />
            ))}
            <ChartTooltip left={((h + 0.5) / n) * 100} flip={h > n / 2} width={width}>
              <div className="font-semibold text-ink">{bucketLabel(usage.t[h], usage.bucket)}</div>
              {h <= last && (
                <TooltipRow label="Used at home" value={now(h) != null ? kWh(now(h)) : "—"} color={COLOR.ink} />
              )}
              {then(h) != null && <TooltipRow label={capital} value={kWh(then(h))} color={THEN} />}
              {(parts.length > 0 || other != null) && (
                <div className="mt-0.5 flex flex-col gap-1.5 border-t border-line pt-2">
                  {[...parts]
                    .sort((a, b) => (b.kwh[h] ?? 0) - (a.kwh[h] ?? 0))
                    .map((p) => (
                      <TooltipRow key={p.id} label={p.label} value={kWh(p.kwh[h])} color={p.color} />
                    ))}
                  {other != null && <TooltipRow label="Everything else" value={kWh(other)} color={OTHER_COLOR} />}
                </div>
              )}
            </ChartTooltip>
          </>
        )}
      </div>
    </div>
  );
}
