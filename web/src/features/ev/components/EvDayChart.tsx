import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { hhmm, shortDay, weekdayLong } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, hourOf, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import {
  DragBand,
  TimeLine,
  TimeTicks,
  timeTicks,
  useDragRange,
  useZoom,
  ZoomOut,
  type LinePoint,
} from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { levelsQuery } from "~/features/ev/api";
import type { EvLevels, EvVehicle } from "~/features/ev/types";
import { EVENT_COLOR } from "~/features/ev/utils";

const GAP = 25 * 60; // readings further apart than this have an estimated line between them
const STEP = 5 * 60; // estimated points along it, so the pointer reads a value anywhere
const ROLLUP = 5 * 60; // what the car drew is kept per five minutes
const SLOT = 30 * 60; // and is shown per half hour
const HOUR = 3600;
const AWAY = COLOR.inkMuted;
const CHARGING = COLOR.good;
const LINE = COLOR.battery;
const SOLAR = COLOR.solar;
const GRID = COLOR.import;
const WAKE = COLOR.lilac;
const NEAR = 10 * 60; // a wake or an event within this of the pointer shows in its tooltip
const WHY: Record<string, string> = {
  first: "to read it after a restart",
  ready: "ready for spare solar",
  refresh: "to read its details",
  command: "for a command",
  solar: "to charge from solar",
};

/** When it slept: from each level logged while asleep back to the point before it. */
const asleepSpans = (points: EvLevels["points"]) =>
  points.flatMap((p, i) => (p.asleep && i > 0 ? [{ start: points[i - 1].t, end: p.t }] : []));

/** Night, when the car should sleep: 10 pm to 6 am. */
const atNight = (t: number) => {
  const h = hourOf(t);
  return h >= 22 || h < 6;
};

/**
 * The line: each reading, and across a gap (away, or not read) a straight line from the reading before to the one
 * after, marked estimated (dashed), with a point every few minutes along it. While the car's asleep its level holds,
 * logged every half hour: a level line, as known, not a gap.
 */
function line(points: EvLevels["points"]): LinePoint[] {
  const out: LinePoint[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && p.t - prev.t > GAP && !p.asleep) {
      out.push({ t: prev.t, v: prev.soc, forecast: true });
      for (let t = prev.t + STEP; t < p.t; t += STEP)
        out.push({ t, v: prev.soc + ((p.soc - prev.soc) * (t - prev.t)) / (p.t - prev.t), forecast: true });
      out.push({ t: p.t, v: p.soc, forecast: true });
    }
    out.push({ t: p.t, v: p.soc });
  });
  return out;
}

/** How long each bar is: half an hour across the day, finer zoomed in (down to the five minutes it's kept in). */
const slotFor = (span: number) => (span <= 3 * HOUR ? ROLLUP : span <= 8 * HOUR ? 15 * 60 : SLOT);

/** What went into it in each `size` from `start` to `end` (kWh): from the grid, and the rest (from solar or the home
 * battery), with the most it drew in any five minutes of it (W). */
function slots(rows: EvLevels["power"], start: number, end: number, size: number) {
  const first = Math.floor(start / size) * size;
  const out = Array.from({ length: Math.ceil((end - first) / size) }, (_, i) => ({
    t: first + i * size,
    solar: 0,
    grid: 0,
    peak: 0,
  }));
  const kwh = ROLLUP / 3600 / 1000;
  for (const r of rows) {
    const s = out[Math.floor((r.t - first) / size)];
    if (!s) continue;
    s.grid += r.grid_w * kwh;
    s.solar += Math.max(0, r.w - r.grid_w) * kwh;
    s.peak = Math.max(s.peak, r.w);
  }
  return out;
}

/**
 * What went into the car from `start` to `end`, a bar each half hour (finer zoomed in) on the same time scale as the
 * chart above: from solar (or the home battery) at the bottom, and from the grid stacked on it. Dragging across it
 * picks a stretch to look at more closely, as on the chart above.
 */
function ChargeBars({
  power,
  start,
  end,
  perAmp,
  onRange,
}: {
  power: EvLevels["power"];
  start: number;
  end: number;
  perAmp: number | null;
  onRange: (from: number, to: number) => void;
}) {
  const { hover: h, width, plot, bar } = useBarHover();
  const range = useDragRange(start, end, onRange);
  const size = slotFor(end - start);
  const bars = slots(power, start, end, size);
  const top = Math.max(0.25, ...bars.map((s) => s.solar + s.grid)) * 1.08;
  const pc = (v: number) => `${(v / top) * 100}%`;
  const leftOf = (t: number) => ((t - start) / (end - start)) * 100;
  const s = h != null && !range.dragging ? bars[h] : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative h-24 cursor-crosshair touch-pan-y overflow-x-clip" {...plot} {...range.handlers}>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-fg/5" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-fg/5" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-fg/12" />
        <DragBand band={range.band} />
        {bars.map((x, i) => {
          const total = x.solar + x.grid;
          return (
            <button
              key={x.t}
              type="button"
              {...bar(i)}
              disabled={total <= 0}
              aria-label={`${hhmm(x.t)}: ${kWh(total)}, ${kWh(x.grid)} from the grid`}
              className={cn(
                "absolute inset-y-0 flex flex-col-reverse border-0 bg-transparent px-[0.5px] py-0 transition-opacity duration-150 enabled:cursor-crosshair",
                s && h !== i && "opacity-50",
              )}
              style={{ left: `${leftOf(x.t)}%`, width: `${(size / (end - start)) * 100}%` }}
            >
              {total > 0 && (
                <span
                  className="bar-grow flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]"
                  style={{ height: pc(total), "--i": i } as CSSProperties}
                >
                  <span
                    className="w-full flex-none"
                    style={{ height: `${(x.solar / total) * 100}%`, background: SOLAR }}
                  />
                  <span
                    className="w-full flex-none"
                    style={{ height: `${(x.grid / total) * 100}%`, background: GRID }}
                  />
                </span>
              )}
            </button>
          );
        })}
        {s && (
          <ChartTooltip left={leftOf(s.t + size / 2)} flip={leftOf(s.t) > 50} width={width}>
            <span className="font-medium text-ink">
              {hhmm(s.t)} – {hhmm(s.t + size)}
            </span>
            <TooltipRow label="Solar or battery" value={kWh(s.solar)} color={SOLAR} />
            <TooltipRow label="Grid" value={kWh(s.grid)} color={GRID} />
            <TooltipRow
              label="Drew up to"
              value={`${kW(s.peak)}${perAmp ? ` · ${Math.round(s.peak / perAmp)} A` : ""}`}
            />
          </ChartTooltip>
        )}
      </div>
      <TimeTicks ticks={timeTicks(start, end, 6)} />
    </div>
  );
}

function dayName(start: number, now: number): string {
  if (start === midnight(now)) return "Today";
  if (start === addDays(midnight(now), -1)) return "Yesterday";
  if (start > addDays(midnight(now), -7)) return weekdayLong.format(new Date(start * 1000));
  return shortDay.format(new Date(start * 1000));
}

function Key({ color, label, dashed, area }: { color: string; label: string; dashed?: boolean; area?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
      {area ? (
        <span className="size-2.5 rounded-[3px]" style={{ background: alpha(color, 0.35) }} />
      ) : (
        <span className="h-0 w-4 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      )}
      {label}
    </span>
  );
}

function Dot({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span className={cn("size-2", square ? "rounded-xs" : "rounded-full")} style={{ background: color }} />
      {label}
    </span>
  );
}

/**
 * The car's day, in one place, day by day: its charge as read (a solid line; estimated in a straight line across the
 * time it wasn't, dashed), when it was away and when it charged at home (shaded), its charge limit, each time the
 * dashboard woke it, and everything the dashboard did with it or saw done, marked along the top; and what went into it
 * while charging at home each half hour, from solar and from the grid.
 */
export function EvDayChart({ v, now, className }: { v: EvVehicle; now: number; className?: string }) {
  const vin = v.vin;
  const [back, setBack] = useState(0);
  const start = addDays(midnight(now), -back);
  const end = addDays(start, 1);
  const zoom = useZoom(start, end); // a stretch of the day dragged across, both charts showing just that
  const { from, to } = zoom;
  const { data } = useQuery({ ...levelsQuery(vin, start, end), placeholderData: keepPreviousData });
  const day = data && data.start === start ? data : null;
  const points = day ? line(day.points) : [];
  const shown = points.filter((p) => p.t >= start && p.t <= Math.min(end, now) && !p.forecast);
  const first = shown[0]?.v;
  const last = shown[shown.length - 1]?.v;
  const spans = [
    ...(day?.away ?? []).map((a) => ({ from: a.start, to: a.end, color: AWAY })),
    ...(day?.charging ?? []).map((c) => ({ from: c.start, to: c.end, color: CHARGING })),
  ];
  const within = (t: number, list: { start: number; end: number }[] | undefined) =>
    (list ?? []).some((s) => s.start <= t && t <= s.end);
  const slept = day ? asleepSpans(day.points) : [];
  const wakes = day?.wakes ?? [];
  const events = (day?.events ?? []).filter((e) => e.kind !== "wake"); // wakes are marked on their own
  const night = wakes.filter((w) => atNight(w.t)).length;
  const near = <T extends { t?: number; ts?: number }>(list: T[], t: number) =>
    list.filter((x) => Math.abs((x.t ?? x.ts ?? 0) - t) <= NEAR);
  const woken = wakes.length
    ? `woken ${wakes.length === 1 ? "once" : `${wakes.length} times`}${night ? ` (${night} at night)` : ""}`
    : null;
  // What went into it: the day's total, and how much of it the grid gave.
  const power = day?.power ?? [];
  const kwh = power.reduce((a, r) => a + r.w, 0) * (ROLLUP / 3600) * 0.001;
  const gridKwh = power.reduce((a, r) => a + r.grid_w, 0) * (ROLLUP / 3600) * 0.001;
  const charged =
    kwh >= 0.05
      ? `charged ${kwh.toFixed(1)} kWh${kwh > 0 ? `, ${Math.round((1 - gridKwh / kwh) * 100)}% from solar or the battery` : ""}`
      : null;
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;

  return (
    <Card aria-labelledby={`h-tlv-${vin}`} className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id={`h-tlv-${vin}`}
          title="Through the day"
          sub={[
            first != null && last != null
              ? `${dayName(start, now)}: ${Math.round(first)}% → ${Math.round(last)}%`
              : dayName(start, now),
            charged,
            woken,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <div className="flex items-center gap-1">
          {zoom.zoomed && <ZoomOut from={from} to={to} onClick={zoom.reset} className="mr-1" />}
          <Button variant="round" aria-label="The day before" disabled={back >= 89} onClick={() => setBack(back + 1)}>
            <Icon name="chevL" size={16} />
          </Button>
          <Button variant="round" aria-label="The day after" disabled={back === 0} onClick={() => setBack(back - 1)}>
            <Icon name="chevR" size={16} />
          </Button>
        </div>
      </div>
      <TimeLine
        points={points}
        start={from}
        end={to}
        onRange={zoom.zoom}
        now={back === 0 ? now : undefined}
        color={LINE}
        height={150}
        domain={[0, 100]}
        spans={spans}
        events={[
          ...wakes.map((w) => ({ t: w.t, color: WAKE, label: `${hhmm(w.t)}: woken ${WHY[w.reason] ?? w.reason}` })),
          ...events.map((e) => ({
            t: e.ts,
            color: e.kind ? EVENT_COLOR[e.kind] : COLOR.inkMuted,
            label: `${hhmm(e.ts)}: ${e.text}`,
          })),
        ]}
        marks={day?.limit != null && back === 0 ? [{ v: day.limit, label: `Limit ${Math.round(day.limit)}%` }] : []}
        tip={(p) =>
          p.v == null ? null : (
            <>
              <span className="font-semibold tabular-nums">{Math.round(p.v)}%</span>
              <span className="text-ink-muted">
                {" "}
                · {hhmm(p.t)}
                {p.forecast ? " · estimated" : within(p.t, slept) ? " · asleep, held since its last reading" : ""}
                {within(p.t, day?.away) ? " · away" : within(p.t, day?.charging) ? " · charging" : ""}
              </span>
              {near(wakes, p.t).map((w) => (
                <span key={`w${w.t}`} className="block text-ink-muted">
                  {hhmm(w.t)}: woken {WHY[w.reason] ?? w.reason}
                </span>
              ))}
              {near(events, p.t)
                .slice(0, 3)
                .map((e, i) => (
                  <span key={`e${e.ts}-${i}`} className="block text-ink-muted">
                    {hhmm(e.ts)}: {e.text}
                  </span>
                ))}
            </>
          )
        }
        empty={zoom.zoomed ? "No readings in this stretch." : "No readings this day."}
      />
      {power.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink-muted">What went into it</span>
          <ChargeBars power={power} start={from} end={to} perAmp={perAmp} onRange={zoom.zoom} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Key color={LINE} label="Charge, as read" />
        <Key color={LINE} label="Estimated (not read)" dashed />
        <Key color={AWAY} label="Away" area />
        <Key color={CHARGING} label="Charging at home" area />
        {power.length > 0 && <Dot color={SOLAR} label="Into the car from solar or battery" square />}
        {power.length > 0 && <Dot color={GRID} label="Into the car from the grid" square />}
        <Dot color={WAKE} label="Woken by the dashboard" />
        <span className="text-xs text-ink-faint max-md:hidden">Drag across a chart to look closer</span>
      </div>
    </Card>
  );
}
