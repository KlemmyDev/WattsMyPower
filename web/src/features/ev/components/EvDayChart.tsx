import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { hhmm, shortDay, weekdayLong } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { levelsQuery } from "~/features/ev/api";
import type { EvEvent, EvLevels, EvVehicle } from "~/features/ev/types";
import { EVENT_COLOR } from "~/features/ev/utils";

const GAP = 25 * 60; // readings further apart than this have an estimated line between them
const STEP = 5 * 60; // estimated points along it, so the pointer reads a value anywhere
const ROLLUP = 5 * 60; // what the car drew is kept per five minutes
const AWAY = COLOR.inkMuted;
const CHARGING = COLOR.good;
const LINE = COLOR.battery;
const POWER = COLOR.solar;
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
  const h = new Date(t * 1000).getHours();
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

/** What it drew (kW) as a line that drops to nothing between the stretches it charged in, so the fill shows each. */
function powerLine(rows: EvLevels["power"], pick: (r: EvLevels["power"][number]) => number): LinePoint[] {
  const out: LinePoint[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (!prev || r.t - prev.t > ROLLUP) {
      if (prev) out.push({ t: prev.t + ROLLUP, v: 0 });
      out.push({ t: r.t, v: 0 });
    }
    out.push({ t: r.t + ROLLUP / 2, v: pick(r) / 1000 });
    if (i === rows.length - 1) out.push({ t: r.t + ROLLUP, v: 0 });
  });
  return out;
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

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** The day's activity, in order, each with when: what the dashboard did with the car, and what it saw done. */
function Activity({ events }: { events: EvEvent[] }) {
  if (!events.length) return <span className="text-[13px] text-ink-muted">Nothing to tell this day.</span>;
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {events.map((e, i) => (
        <li key={`${e.ts}-${i}`} className="relative flex gap-3 pb-2.5 last:pb-0">
          <span className="relative flex w-3 flex-none justify-center">
            <span
              aria-hidden
              className="z-1 mt-1.5 size-2.5 rounded-full ring-4 ring-surface"
              style={{ background: e.kind ? EVENT_COLOR[e.kind] : COLOR.inkMuted }}
            />
            {i < events.length - 1 && <span aria-hidden className="absolute top-3 -bottom-1 w-px bg-line" />}
          </span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs text-ink-faint tabular-nums">{hhmm(e.ts)}</span>
            <span className="text-[13px] text-pretty">{e.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The car's day, in one place, day by day: its charge as read (a solid line; estimated in a straight line across the
 * time it wasn't, dashed), when it was away and when it charged at home (shaded), its charge limit, each time the
 * dashboard woke it; what it drew while charging at home (and of that, what came from the grid); and everything the
 * dashboard did with it or saw done, marked on the chart and listed below it.
 */
export function EvDayChart({ v, now, className }: { v: EvVehicle; now: number; className?: string }) {
  const vin = v.vin;
  const [back, setBack] = useState(0);
  const start = addDays(midnight(now), -back);
  const end = addDays(start, 1);
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
  const drawn = powerLine(power, (r) => r.w);
  const fromGrid = powerLine(power, (r) => r.grid_w);
  const top = Math.max(1, ...power.map((r) => r.w / 1000));

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
        start={start}
        end={end}
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
        empty="No readings this day."
      />
      {power.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink-muted">What went into it</span>
          <TimeLine
            points={drawn}
            compare={{ points: fromGrid, color: GRID }}
            start={start}
            end={end}
            now={back === 0 ? now : undefined}
            color={POWER}
            height={80}
            domain={[0, top]}
            fill
            tip={(p, other) =>
              p.v == null ? null : (
                <>
                  <span className="font-semibold tabular-nums">{kW(p.v * 1000)}</span>
                  <span className="text-ink-muted">
                    {perAmp ? ` · ${Math.round((p.v * 1000) / perAmp)} A` : ""} · {hhmm(p.t)}
                    {other?.v ? ` · ${kW(other.v * 1000)} from the grid` : p.v > 0 ? " · all solar or battery" : ""}
                  </span>
                </>
              )
            }
            empty=""
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Key color={LINE} label="Charge, as read" />
        <Key color={LINE} label="Estimated (not read)" dashed />
        <Key color={AWAY} label="Away" area />
        <Key color={CHARGING} label="Charging at home" area />
        {power.length > 0 && <Key color={POWER} label="Going into the car" area />}
        {power.length > 0 && <Key color={GRID} label="Of it, from the grid" dashed />}
        <Dot color={WAKE} label="Woken by the dashboard" />
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-4">
        <span className="text-sm font-semibold">What happened</span>
        <Activity events={events} />
      </div>
    </Card>
  );
}
