import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { hhmm, weekdayLong, shortDay } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import { levelsQuery } from "~/features/ev/api";
import type { EvLevels } from "~/features/ev/types";

const GAP = 25 * 60; // readings further apart than this have an estimated line between them
const STEP = 5 * 60; // estimated points along it, so the pointer reads a value anywhere
const AWAY = COLOR.inkMuted;
const CHARGING = COLOR.good;
const LINE = COLOR.battery;
const WAKE = COLOR.lilac;
const NEAR = 10 * 60; // a wake within this of the pointer shows in its tooltip
const WHY: Record<string, string> = {
  first: "to read it after a restart",
  ready: "ready for spare solar",
  refresh: "to read its details",
  command: "for a command",
  solar: "to charge from solar",
};
/** Night, when the car should sleep: 10 pm to 6 am. */
const atNight = (t: number) => {
  const h = new Date(t * 1000).getHours();
  return h >= 22 || h < 6;
};

/**
 * The line: each reading, and across a gap (away, or asleep and not read) a straight line from the reading before to
 * the one after, marked estimated (dashed), with a point every few minutes along it.
 */
function line(points: EvLevels["points"]): LinePoint[] {
  const out: LinePoint[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && p.t - prev.t > GAP) {
      out.push({ t: prev.t, v: prev.soc, forecast: true });
      for (let t = prev.t + STEP; t < p.t; t += STEP)
        out.push({ t, v: prev.soc + ((p.soc - prev.soc) * (t - prev.t)) / (p.t - prev.t), forecast: true });
      out.push({ t: p.t, v: p.soc, forecast: true });
    }
    out.push({ t: p.t, v: p.soc });
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

/**
 * The car's charge through a day: as it was read (a solid line), estimated in a straight line across the time it
 * wasn't (away, or asleep: dashed), with when it was away and when it charged at home shaded, and its charge limit.
 */
export function EvLevelChart({ vin, now, className }: { vin: string; now: number; className?: string }) {
  const [back, setBack] = useState(0);
  const start = addDays(midnight(now), -back);
  const end = addDays(start, 1);
  const { data } = useQuery({ ...levelsQuery(vin, start, end), placeholderData: keepPreviousData });
  const points = data && data.start === start ? line(data.points) : [];
  const shown = points.filter((p) => p.t >= start && p.t <= Math.min(end, now) && !p.forecast);
  const first = shown[0]?.v;
  const last = shown[shown.length - 1]?.v;
  const spans = [
    ...(data?.away ?? []).map((a) => ({ from: a.start, to: a.end, color: AWAY })),
    ...(data?.charging ?? []).map((c) => ({ from: c.start, to: c.end, color: CHARGING })),
  ];
  const within = (t: number, list: { start: number; end: number }[] | undefined) =>
    (list ?? []).some((s) => s.start <= t && t <= s.end);
  const wakes = data && data.start === start ? data.wakes : [];
  const night = wakes.filter((w) => atNight(w.t)).length;
  const wokeNear = (t: number) => wakes.find((w) => Math.abs(w.t - t) <= NEAR);
  const woken = wakes.length
    ? ` · woken ${wakes.length === 1 ? "once" : `${wakes.length} times`}${night ? ` (${night} at night)` : ""}`
    : "";

  return (
    <Card aria-labelledby={`h-tlv-${vin}`} className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id={`h-tlv-${vin}`}
          title="Charge through the day"
          sub={
            (first != null && last != null
              ? `${dayName(start, now)}: ${Math.round(first)}% → ${Math.round(last)}%`
              : dayName(start, now)) + woken
          }
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
        height={170}
        domain={[0, 100]}
        spans={spans}
        events={wakes.map((w) => ({
          t: w.t,
          color: WAKE,
          label: `${hhmm(w.t)}: woken ${WHY[w.reason] ?? w.reason}`,
        }))}
        marks={data?.limit != null && back === 0 ? [{ v: data.limit, label: `Limit ${Math.round(data.limit)}%` }] : []}
        tip={(p) =>
          p.v == null ? null : (
            <>
              <span className="font-semibold tabular-nums">{Math.round(p.v)}%</span>
              <span className="text-ink-muted">
                {" "}
                · {hhmm(p.t)}
                {p.forecast ? " · estimated" : ""}
                {within(p.t, data?.away) ? " · away" : within(p.t, data?.charging) ? " · charging" : ""}
                {(() => {
                  const w = wokeNear(p.t);
                  return w ? ` · woken at ${hhmm(w.t)}, ${WHY[w.reason] ?? w.reason}` : "";
                })()}
              </span>
            </>
          )
        }
        empty="No readings this day."
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Key color={LINE} label="Charge, as read" />
        <Key color={LINE} label="Estimated (not read)" dashed />
        <Key color={AWAY} label="Away" area />
        <Key color={CHARGING} label="Charging at home" area />
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="size-2 rounded-full" style={{ background: WAKE }} />
          Woken by the dashboard
        </span>
      </div>
    </Card>
  );
}
