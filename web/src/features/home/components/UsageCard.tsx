import { useState, type PointerEvent } from "react";
import { hourLabel, shortDay } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, nowS } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { ChartTooltip, HoverLine, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
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

/** What's being compared with, drawn dashed: the day before's line, or the period before's bars. */
const THEN = alpha(COLOR.fg, 0.5);

const share = (part: number, whole: number | null) => (whole ? `${Math.round((part / whole) * 100)}%` : null);

/** A round top for the chart. */
function niceMax(v: number) {
  const step = v > 20 ? 5 : v > 5 ? 1 : v > 1 ? 0.5 : 0.1;
  return Math.max(step, Math.ceil(v / step) * step);
}

function bucketLabel(t: number, bucket: "hour" | "day") {
  const d = new Date(t * 1000);
  return bucket === "hour" ? `${hourLabel(d.getHours())}–${hourLabel((d.getHours() + 1) % 24)}` : shortDay.format(d);
}

/** Every few bars gets an axis label: each hour's 3rd, each day for a week, every 5th day for a month. */
function axisLabel(t: number, i: number, n: number, bucket: "hour" | "day") {
  const d = new Date(t * 1000);
  if (bucket === "hour") return d.getHours() % 6 === 0 ? hourLabel(d.getHours()) : null;
  if (n <= 8) return WEEKDAY_SHORT[(d.getDay() + 6) % 7];
  return i % 5 === 0 || i === n - 1 ? String(d.getDate()) : null;
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
    return `Your home cost ${money(c.supply)} ${rangeWords}, all of it supply charges: everything it used came from your panels and battery.`;
  const charged = usage.car && usage.car.cost >= 0.01 ? [{ name: "the car", cost: usage.car.cost }] : [];
  const top = [...devices, ...charged].filter((d) => d.cost >= 0.01).sort((a, b) => b.cost - a.cost);
  const named = top.slice(0, 3).map((d) => `${d.name} ${money(d.cost)}`);
  if (top.length > 3) named.push(`your other devices ${money(top.slice(3).reduce((a, d) => a + d.cost, 0))}`);
  const parts = [...named, `everything else ${money(c.other)}`];
  return `Your home cost ${money(c.import + c.supply)} ${rangeWords}: ${listed(parts)}, and ${money(c.supply)} in supply charges.`;
}

/**
 * Where the home's power went: everything the home used, each device's part of it, and what no device measures
 * ("everything else"), with what it cost. The share as one bar with its key, then the same split hour by hour, or
 * day by day. Each part of the key hides or shows its part of the chart (double-click: only it), so one room's use
 * can be seen on its own.
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
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set()); // parts hidden from the chart (0: everything else)
  const devices = (usage?.devices ?? []).filter((d) => colors.has(d.id));
  const total = usage?.total;
  const parts = [
    ...devices.map((d) => ({ id: d.id, label: d.name, kwh: d.total, cost: d.cost, color: colors.get(d.id)! })),
    ...(usage?.car && usage.car.total > 0
      ? [{ id: CAR_ID, label: "Car charging", kwh: usage.car.total, cost: usage.car.cost, color: CAR_COLOR }]
      : []),
    ...(total?.other != null
      ? [{ id: 0, label: "Everything else", kwh: total.other, cost: total.cost.other, color: OTHER_COLOR }]
      : []),
  ];
  const whole = total?.home ?? null;
  const sum = parts.reduce((a, p) => a + p.kwh, 0);
  const toggle = (id: number) =>
    setOff((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === parts.length ? new Set() : next; // hiding the last one shows them all again
    });
  const only = (id: number) => setOff(new Set(parts.map((p) => p.id).filter((p) => p !== id)));

  return (
    <Card aria-labelledby="h-usage" className="col-span-12 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-usage">Where your power went</h2>
          <span className="text-[13px] text-ink-muted">
            What your home used, from the inverter, and what each connected device used of it
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
        <Skeleton className="h-[300px]" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Used at home</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">
                {whole != null ? kWh(whole) : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-muted">Cost</span>
              <span className="text-[40px] leading-11 font-light tracking-[-1.5px] tabular-nums">
                {money(usage.total.cost.import + usage.total.cost.supply)}
              </span>
            </div>
            <div className="flex flex-col gap-1 pb-1.5 text-sm text-ink-muted tabular-nums">
              <span>
                <b className="font-semibold text-ink">{kWh(total?.measured ?? 0)}</b> measured by your devices
                {whole ? ` (${share(total?.measured ?? 0, whole)})` : ""}
              </span>
              {usage.total.cost.credit > 0 && <span>{money(usage.total.cost.credit)} earned from feed-in</span>}
              {whole == null && <span>No inverter readings in this period, so only what the devices measured</span>}
              {compare && previous && <ComparedLine usage={usage} previous={previous} words={previousWords} />}
            </div>
          </div>
          {usage.total.cost.import + usage.total.cost.supply > 0 && (
            <p className="m-0 -mt-2 text-sm text-pretty text-ink-muted">{costLine(usage, devices, rangeWords)}</p>
          )}

          {sum > 0 && (
            <div className="flex flex-col gap-3">
              <div
                className="flex h-3 gap-[2px] overflow-hidden rounded-full"
                role="img"
                aria-label="Share of home use"
              >
                {parts
                  .filter((p) => p.kwh > 0)
                  .map((p) => (
                    <span
                      key={p.id}
                      style={{ flexGrow: p.kwh, background: p.color }}
                      className={cn("min-w-[3px] transition-opacity", off.has(p.id) && "opacity-25")}
                    />
                  ))}
              </div>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-0">
                {parts.map((p) => {
                  const shown = !off.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={shown}
                        title="Show or hide it in the chart (double-click: only it)"
                        onClick={() => toggle(p.id)}
                        onDoubleClick={() => only(p.id)}
                        style={
                          shown ? { borderColor: alpha(p.color, 0.55), background: alpha(p.color, 0.1) } : undefined
                        }
                        className={cn(
                          "flex h-full w-full cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5 text-left font-sans text-ink tabular-nums transition-[background,border-color,opacity] select-none",
                          shown
                            ? "hover:brightness-110"
                            : "border-dashed border-line bg-transparent opacity-55 hover:opacity-80",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="size-2.5 flex-none rounded-full border-2"
                            style={{ borderColor: p.color, background: shown ? p.color : "transparent" }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">{p.label}</span>
                        </span>
                        <span className="text-[17px] leading-5 font-semibold">{kWh(p.kwh)}</span>
                        <span className="text-xs text-ink-faint">
                          {[p.cost >= 0.005 ? money(p.cost) : null, share(p.kwh, whole)].filter(Boolean).join(" · ") ||
                            "\u00a0"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <span className="-mt-1 text-xs text-ink-faint">
                Tap a card to show or hide it in the chart, or double-click to see it on its own.
              </span>
              {off.size > 0 && (
                <button
                  type="button"
                  onClick={() => setOff(new Set())}
                  className="cursor-pointer self-start border-0 bg-transparent p-0 font-sans text-[13px] text-brand hover:underline"
                >
                  Show everything
                </button>
              )}
            </div>
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
          {usage.bucket === "hour" ? (
            <Lines
              usage={usage}
              devices={devices.filter((d) => !off.has(d.id))}
              car={off.has(CAR_ID) ? null : usage.car}
              other={!off.has(0)}
              filtered={off.size > 0}
              colors={colors}
              previous={compare ? previous : undefined}
              previousWords={previousWords}
            />
          ) : (
            <Bars
              usage={usage}
              devices={devices.filter((d) => !off.has(d.id))}
              car={off.has(CAR_ID) ? null : usage.car}
              other={!off.has(0)}
              filtered={off.size > 0}
              colors={colors}
              hover={hover}
              setHover={setHover}
              previous={compare ? previous : undefined}
            />
          )}
        </>
      )}
    </Card>
  );
}

function Bars({
  usage,
  devices,
  car,
  other,
  filtered,
  colors,
  hover,
  setHover,
  previous,
}: {
  usage: HomeUsage;
  /** The same period before, drawn as a dashed outline behind each day's bar (the day the same distance back). */
  previous?: HomeUsage;
  /** The devices shown. */
  devices: HomeUsage["devices"];
  /** The car's charging, if shown. */
  car: HomeUsage["car"];
  /** Everything else is shown. */
  other: boolean;
  /** Some parts are hidden: the chart is scaled to what's shown, rather than the home's whole use. */
  filtered: boolean;
  colors: Map<number, string>;
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const [width, setWidth] = useState(0);
  const n = usage.t.length;
  const shown = (i: number) =>
    devices.reduce((a, d) => a + d.kwh[i], 0) + (car?.kwh[i] ?? 0) + (other ? (usage.other[i] ?? 0) : 0);
  const height = (i: number) => (filtered ? shown(i) : Math.max(usage.home[i] ?? 0, shown(i)));
  const then = (i: number) =>
    previous && i < previous.t.length ? total(previous, i, devices, car, other, filtered) : null;
  const top = niceMax(Math.max(0, ...usage.t.map((_, i) => Math.max(height(i), then(i) ?? 0))));
  const pc = (v: number) => `${Math.max(0, (v / top) * 100)}%`;
  const h = hover != null ? hover : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        // Layout px, as the tooltip is placed in.
        onPointerEnter={(e) => setWidth(e.currentTarget.offsetWidth)}
        onFocus={(e) => setWidth(e.currentTarget.offsetWidth)}
        className="relative flex h-[220px] items-end gap-[3px] pr-12 max-sm:h-[180px] max-sm:gap-[2px] max-sm:pr-10"
        onMouseLeave={() => setHover(null)}
      >
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
        {usage.t.map((t, i) => {
          const label = bucketLabel(t, usage.bucket);
          return (
            <button
              key={t}
              type="button"
              aria-label={`${label}: ${usage.home[i] != null ? `${kWh(usage.home[i])} used` : "no inverter readings"}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className={cn(
                "relative flex h-full min-w-0 flex-1 cursor-default flex-col-reverse gap-[2px] rounded-t-[4px] border-0 bg-transparent p-0",
                h != null && h !== i && "opacity-60",
              )}
            >
              {then(i) != null && then(i)! > 0 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-1 rounded-t-[4px] border-[1.5px] border-b-0 border-dashed"
                  style={{ height: pc(then(i)!), borderColor: THEN }}
                />
              )}
              {devices.map((d) =>
                d.kwh[i] > 0 ? (
                  <span
                    key={d.id}
                    className="w-full flex-none first:rounded-b-none last:rounded-t-[4px]"
                    style={{ height: pc(d.kwh[i]), background: colors.get(d.id) }}
                  />
                ) : null,
              )}
              {car && car.kwh[i] > 0 && (
                <span
                  className="w-full flex-none last:rounded-t-[4px]"
                  style={{ height: pc(car.kwh[i]), background: CAR_COLOR }}
                />
              )}
              {other && (usage.other[i] ?? 0) > 0 && (
                <span
                  className="w-full flex-none rounded-t-[4px]"
                  style={{ height: pc(usage.other[i]!), background: OTHER_COLOR }}
                />
              )}
            </button>
          );
        })}
        {h != null && (
          <ChartTooltip left={((h + 0.5) / n) * 100} flip={h > n / 2} width={width}>
            <div className="font-semibold text-ink">{bucketLabel(usage.t[h], usage.bucket)}</div>
            {devices
              .filter((d) => d.kwh[h] > 0)
              .map((d) => (
                <TooltipRow key={d.id} label={d.name} value={kWh(d.kwh[h])} color={colors.get(d.id)} />
              ))}
            {car && car.kwh[h] > 0 && <TooltipRow label="Car charging" value={kWh(car.kwh[h])} color={CAR_COLOR} />}
            {other && usage.other[h] != null && (
              <TooltipRow label="Everything else" value={kWh(usage.other[h])} color={OTHER_COLOR} />
            )}
            {filtered && <TooltipRow label="Shown" value={kWh(shown(h))} />}
            <TooltipRow label="Used at home" value={usage.home[h] != null ? kWh(usage.home[h]) : "—"} />
            {previous && then(h) != null && (
              <TooltipRow label={shortDay.format(new Date(previous.t[h] * 1000))} value={kWh(then(h)!)} color={THEN} />
            )}
          </ChartTooltip>
        )}
      </div>
      <div className="flex gap-[3px] pr-12 font-mono text-[10px] text-ink-faint max-sm:gap-[2px] max-sm:pr-10">
        {usage.t.map((t, i) => (
          <span key={t} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {axisLabel(t, i, n, usage.bucket) ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * What a period shows at bucket `i`: the home's use, or, with parts hidden, the parts shown (found by id, as `u` may be
 * another period's).
 */
function total(
  u: HomeUsage,
  i: number,
  devices: HomeUsage["devices"],
  car: HomeUsage["car"],
  other: boolean,
  filtered: boolean,
): number | null {
  if (!filtered) return u.home[i] ?? null;
  return (
    devices.reduce((a, d) => a + (u.devices.find((x) => x.id === d.id)?.kwh[i] ?? 0), 0) +
    (car ? (u.car?.kwh[i] ?? 0) : 0) +
    (other ? (u.other[i] ?? 0) : 0)
  );
}

/** The home's use against the period before's, in a line. A day still going is compared up to the same hour. */
function ComparedLine({ usage, previous, words }: { usage: HomeUsage; previous: HomeUsage; words: string }) {
  const going = usage.bucket === "hour" && usage.end > nowS();
  const n = going ? usage.home.findLastIndex((v) => v != null) + 1 : usage.t.length;
  const sum = (u: HomeUsage) => u.home.slice(0, n).reduce<number>((a, v) => a + (v ?? 0), 0);
  const now = sum(usage);
  const then = sum(previous);
  if (n <= 0 || then < 0.05) return null;
  const change = (now - then) / then;
  return (
    <span>
      {Math.abs(change) < 0.05
        ? `About the same as ${words}`
        : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more" : "less"} than ${words}`}
      {going ? " by this time" : ""}
    </span>
  );
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
const LH = 220;
const LINE = {
  fill: "none",
  vectorEffect: "non-scaling-stroke",
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/**
 * A day hour by hour as lines: what the home used (or, with parts hidden, the parts shown together) over a soft area,
 * each part shown as a thinner line in its colour, and the day before's dashed when compared. Each hour's point sits
 * mid-hour; a day still going stops at its last hour with readings. The hour under the pointer is summed up in a
 * tooltip.
 */
function Lines({
  usage,
  devices,
  car,
  other,
  filtered,
  colors,
  previous,
  previousWords,
}: {
  usage: HomeUsage;
  devices: HomeUsage["devices"];
  car: HomeUsage["car"];
  other: boolean;
  filtered: boolean;
  colors: Map<number, string>;
  previous?: HomeUsage;
  previousWords: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const n = usage.t.length;
  // The last hour with readings (or with a device's, before the inverter's arrive).
  const last = Math.max(
    usage.home.findLastIndex((v) => v != null),
    ...devices.map((d) => d.kwh.findLastIndex((v) => v > 0)),
  );
  const now = (i: number) => total(usage, i, devices, car, other, filtered);
  const then = (i: number) =>
    previous && i < previous.t.length ? total(previous, i, devices, car, other, filtered) : null;
  const parts = [
    ...devices.map((d) => ({ key: `d${d.id}`, label: d.name, color: colors.get(d.id)!, kwh: d.kwh })),
    ...(car ? [{ key: "car", label: "Car charging", color: CAR_COLOR, kwh: car.kwh }] : []),
    ...(other
      ? [{ key: "other", label: "Everything else", color: OTHER_COLOR, kwh: usage.other.map((v) => v ?? 0) }]
      : []),
  ];
  const upto = Array.from({ length: Math.max(0, last + 1) }, (_, i) => i);
  const all = Array.from({ length: n }, (_, i) => i);
  const top = niceMax(
    Math.max(
      0,
      ...upto.map((i) => now(i) ?? 0),
      ...parts.flatMap((p) => upto.map((i) => p.kwh[i])),
      ...all.map((i) => then(i) ?? 0),
    ),
  );
  const X = (i: number) => ((i + 0.5) / n) * LW;
  const Y = (v: number) => LH - (Math.max(0, v) / top) * (LH - 6);
  const pts = (idx: number[], v: (i: number) => number | null) =>
    idx.filter((i) => v(i) != null).map((i): [number, number] => [X(i), Y(v(i)!)]);
  const main = pts(upto, now);
  const before = previous ? pts(all, then) : [];
  const mainD = smooth(main);
  const area =
    main.length > 1 ? `${mainD} L${main[main.length - 1][0].toFixed(1)} ${LH} L${main[0][0].toFixed(1)} ${LH} Z` : "";
  const pc = (v: number) => (Y(v) / LH) * 100;

  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setWidth(e.currentTarget.offsetWidth); // layout px, as the tooltip is placed in
    const i = Math.floor(Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)) * n);
    setHover(i <= last || then(i) != null ? i : last >= 0 ? last : null);
  };
  const h = hover;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[220px] pr-12 max-sm:h-[180px] max-sm:pr-10">
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
        <div className="absolute inset-y-0 right-12 left-0 border-b border-fg/8 max-sm:right-10" />
        <div
          role="img"
          aria-label={`What your home used hour by hour${previous ? `, with ${previousWords} dashed` : ""}`}
          className="relative h-full cursor-crosshair touch-pan-y"
          onPointerMove={onPoint}
          onPointerDown={onPoint}
          onPointerLeave={() => setHover(null)}
        >
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
            {area && <path d={area} style={{ fill: "url(#usage-area)" }} className="animate-fade" />}
            {parts.map((p) => (
              <path
                key={p.key}
                d={smooth(pts(upto, (i) => p.kwh[i]))}
                {...LINE}
                style={{ stroke: p.color }}
                strokeWidth={1.6}
                strokeOpacity={0.9}
              />
            ))}
            {before.length > 1 && (
              <path d={smooth(before)} {...LINE} style={{ stroke: THEN }} strokeWidth={1.6} strokeDasharray="5 5" />
            )}
            {main.length > 1 && <path d={mainD} {...LINE} style={{ stroke: COLOR.ink }} strokeWidth={2.4} />}
          </svg>
          {h != null && (
            <>
              <HoverLine left={((h + 0.5) / n) * 100} />
              {[
                ...(h <= last ? parts.map((p) => ({ key: p.key, v: p.kwh[h], color: p.color })) : []),
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
                <div className="font-semibold text-ink">{bucketLabel(usage.t[h], "hour")}</div>
                {h <= last &&
                  parts
                    .filter((p) => p.kwh[h] > 0)
                    .map((p) => <TooltipRow key={p.key} label={p.label} value={kWh(p.kwh[h])} color={p.color} />)}
                {h <= last && (
                  <TooltipRow
                    label={filtered ? "Shown" : "Used at home"}
                    value={now(h) != null ? kWh(now(h)) : "—"}
                    color={COLOR.ink}
                  />
                )}
                {then(h) != null && (
                  <TooltipRow
                    label={previousWords.charAt(0).toUpperCase() + previousWords.slice(1)}
                    value={kWh(then(h))}
                    color={THEN}
                  />
                )}
              </ChartTooltip>
            </>
          )}
        </div>
      </div>
      <div className="flex pr-12 font-mono text-[10px] text-ink-faint max-sm:pr-10">
        {usage.t.map((t, i) => (
          <span key={t} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {axisLabel(t, i, n, "hour") ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}
