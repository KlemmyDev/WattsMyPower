import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { controlHistoryQuery } from "~/features/battery/api";
import type { BatteryEvent, BatteryPlan, ControlKind, ControlRecord } from "~/features/battery/types";
import { KIND_COLOR, KIND_LABEL, recordLabel, when } from "~/features/battery/utils";
import { batteryState, reserveOf } from "~/features/common/energy/utils";
import { hhmm, hourLabel, shortDay } from "~/features/common/formatting/utils/date";
import { kW, pct } from "~/features/common/formatting/utils/number";
import type { SystemInfo } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

const W = 1000;
const H = 260;
const TOP = 26; // room for the controls' labels
const BOTTOM = 8;
const y = (soc: number) => TOP + (1 - Math.max(0, Math.min(100, soc)) / 100) * (H - TOP - BOTTOM);

type Point = { t: number; soc: number; w: number | null };
type Band = { kind: ControlKind; from: number; to: number; label: string; floor: number | null; ahead: boolean };

/** The controls as shaded stretches of the day: a running one reaches to where it's set to end (or as far as it's
 * worked out), the part still to come drawn fainter. */
function bandsOf(controls: ControlRecord[], plan: BatteryPlan | null, start: number, end: number, now: number) {
  const out: Band[] = [];
  for (const c of controls) {
    const stop = c.ended_at ?? c.until ?? plan?.ends_at ?? plan?.to ?? now;
    const from = Math.max(c.started_at, start);
    const past = Math.min(c.ended_at ?? now, stop, end);
    const label = recordLabel(c);
    if (past > from) out.push({ kind: c.kind, from, to: past, label, floor: c.floor, ahead: false });
    if (c.ended_at == null && stop > now && now < end)
      out.push({
        kind: c.kind,
        from: Math.max(now, from),
        to: Math.min(stop, end),
        label: past > from ? "" : label,
        floor: c.floor,
        ahead: true,
      });
  }
  return out;
}

/**
 * A day of the battery: its level through the day, the controls that ran shaded behind it (with a floor drawn as a
 * line), and from now on what the control in effect, or the one being set up (`preview`), will do. Step back
 * through earlier days with the arrows.
 */
export function BatteryDayChart({
  s,
  now,
  plan,
  preview,
  log,
}: {
  s: SystemInfo | undefined;
  now: number;
  plan: BatteryPlan | null;
  preview: BatteryPlan | null;
  /** What the controls did lately, listed under the chart. */
  log: BatteryEvent[];
}) {
  const today = midnight(now);
  const [day, setDay] = useState(today);
  const start = day;
  const end = addDays(day, 1);
  const isToday = day === today;
  const { data } = useQuery({
    ...historyQuery({
      start,
      end: isToday ? Math.min(end, now + 60) : end,
      points: 288,
      fields: ["battery_soc", "battery_power"],
      live: isToday,
    }),
    placeholderData: keepPreviousData,
  });
  const { data: hist } = useQuery({ ...controlHistoryQuery(start, end), placeholderData: keepPreviousData });

  const X = (t: number) => ((t - start) / (end - start)) * W;
  const points = useMemo<Point[]>(() => {
    if (!data) return [];
    const sr = data.series;
    return sr.t
      .map((t, i) => ({ t, soc: sr.battery_soc?.[i] ?? null, w: sr.battery_power?.[i] ?? null }))
      .filter((p): p is Point => p.soc != null);
  }, [data]);
  const runs = useMemo(() => {
    // Split where readings are missing (a gap of more than 15 minutes).
    const out: Point[][] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && p.t - last[last.length - 1].t <= 900) last.push(p);
      else out.push([p]);
    }
    return out.filter((r) => r.length > 1);
  }, [points]);
  const bands = bandsOf(hist?.controls ?? [], isToday ? plan : null, start, end, now);
  // The control being set up, over the stretch it would run.
  if (isToday && preview) {
    const to = Math.min(preview.ends_at ?? preview.to, end);
    if (to > now)
      bands.push({
        kind: preview.kind,
        from: now,
        to,
        label: recordLabel(preview),
        floor: preview.floor,
        ahead: true,
      });
  }
  const ahead = (p: BatteryPlan | null) => (isToday && p ? p.points.filter(([t]) => t >= now - 60 && t <= end) : []);
  const planLine = ahead(plan);
  const previewLine = ahead(preview);
  const reserve = reserveOf(s);

  const box = useRef<HTMLDivElement>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const onMove = (e: MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setHoverAt(start + ((e.clientX - r.left) / r.width) * (end - start));
  };
  const hover = hoverAt == null ? null : nearestPoint(points, planLine, previewLine, hoverAt);
  const hoverBand = hoverAt == null ? null : (bands.find((b) => b.from <= hoverAt && hoverAt < b.to) ?? null);

  const path = (pts: [number, number][]) =>
    pts.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const kinds = [...new Set(bands.map((b) => b.kind))];

  return (
    <Card aria-labelledby="h-bday" className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-bday">{isToday ? "Today" : shortDay.format(new Date(day * 1000))}</h2>
          <span className="text-[13px] text-ink-muted">The battery's level, and what it was set to do</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="icon" aria-label="The day before" onClick={() => setDay(addDays(day, -1))}>
            <Icon name="chevL" size={16} />
          </Button>
          <Button
            variant="icon"
            aria-label="The day after"
            disabled={isToday}
            onClick={() => setDay(addDays(day, 1))}
            className="disabled:opacity-40"
          >
            <Icon name="chevR" size={16} />
          </Button>
        </div>
      </div>

      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-xs text-ink-muted">
        <Key swatch={<span className="h-0.5 w-4 rounded-full" style={{ background: COLOR.battery }} />}>Level</Key>
        {(planLine.length > 1 || previewLine.length > 1) && (
          <Key swatch={<span className="w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.battery }} />}>
            {previewLine.length > 1 && planLine.length < 2 ? "If you start it" : "Expected"}
          </Key>
        )}
        {kinds.map((k) => (
          <Key
            key={k}
            swatch={<span className="size-3 rounded-[3px]" style={{ background: alpha(KIND_COLOR[k], 0.35) }} />}
          >
            {KIND_LABEL[k]}
          </Key>
        ))}
        <Key swatch={<span className="w-4 border-t border-dashed" style={{ borderColor: alpha(COLOR.fg, 0.35) }} />}>
          Reserve {pct(reserve)}
        </Key>
      </ul>

      <div
        ref={box}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverAt(null)}
        className="relative h-[260px] cursor-crosshair max-sm:h-[200px]"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 block size-full"
        >
          <defs>
            <linearGradient id="bday-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopOpacity="0.28" style={{ stopColor: COLOR.battery }} />
              <stop offset="1" stopOpacity="0" style={{ stopColor: COLOR.battery }} />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((v) => (
            <line
              key={v}
              x1="0"
              x2={W}
              y1={y(v)}
              y2={y(v)}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.06) }}
            />
          ))}
          {bands.map((b, i) => (
            <g key={i}>
              <rect
                x={X(b.from)}
                y={TOP - 4}
                width={Math.max(1, X(b.to) - X(b.from))}
                height={H - TOP - BOTTOM + 4}
                rx="4"
                style={{ fill: alpha(KIND_COLOR[b.kind], b.ahead ? 0.08 : 0.16) }}
              />
              {b.floor != null && (
                <line
                  x1={X(b.from)}
                  x2={X(b.to)}
                  y1={y(b.floor)}
                  y2={y(b.floor)}
                  strokeWidth="2"
                  strokeDasharray={b.ahead ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                  style={{ stroke: KIND_COLOR[b.kind] }}
                />
              )}
            </g>
          ))}
          <line
            x1="0"
            x2={W}
            y1={y(reserve)}
            y2={y(reserve)}
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: alpha(COLOR.fg, 0.25) }}
          />
          {runs.map((r, i) => (
            <path
              key={`a${i}`}
              d={`${path(r.map((p) => [p.t, p.soc]))} L${X(r[r.length - 1].t).toFixed(1)} ${H} L${X(r[0].t).toFixed(1)} ${H} Z`}
              fill="url(#bday-fill)"
            />
          ))}
          {runs.map((r, i) => (
            <path
              key={`l${i}`}
              d={path(r.map((p) => [p.t, p.soc]))}
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: COLOR.battery }}
            />
          ))}
          {planLine.length > 1 && (
            <path
              d={path(planLine)}
              fill="none"
              strokeWidth="2"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: COLOR.battery }}
            />
          )}
          {previewLine.length > 1 && (
            <path
              d={path(previewLine)}
              fill="none"
              strokeWidth="2"
              strokeDasharray="2 5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: COLOR.batterySoft }}
            />
          )}
          {isToday && (
            <line
              x1={X(now)}
              x2={X(now)}
              y1={TOP - 4}
              y2={H}
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.3) }}
            />
          )}
        </svg>
        {/* The controls' names over their stretch, and the axis labels, in HTML so they don't stretch. */}
        {bands
          .filter((b) => b.label)
          .map((b, i) => {
            // Each name starts at its stretch and may run past a short one; near the right edge it ends there instead.
            const late = X(b.from) / W > 0.72;
            return (
              <span
                key={i}
                className="pointer-events-none absolute top-0 flex items-center gap-1.5 px-1 text-[11px] font-semibold whitespace-nowrap text-ink-muted"
                style={late ? { right: `${100 - (X(b.to) / W) * 100}%` } : { left: `${(X(b.from) / W) * 100}%` }}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ background: KIND_COLOR[b.kind] }} />
                {b.label}
              </span>
            );
          })}
        {[100, 50, 0].map((v) => (
          <span
            key={v}
            className="pointer-events-none absolute right-0 -translate-y-1/2 text-[10px] text-ink-faint tabular-nums"
            style={{ top: `${(y(v) / H) * 100}%` }}
          >
            {v}%
          </span>
        ))}
        {isToday && (
          <span
            className="pointer-events-none absolute -bottom-5 -translate-x-1/2 text-[10px] font-semibold text-ink-muted"
            style={{ left: `${(X(now) / W) * 100}%` }}
          >
            Now
          </span>
        )}
        {hover && hoverAt != null && (
          <Readout p={hover} band={hoverBand} left={(X(hover.t) / W) * 100} top={(y(hover.soc) / H) * 100} />
        )}
      </div>
      <div className="relative mt-1 h-4 font-mono text-[10px] text-ink-faint tabular-nums">
        {[0, 6, 12, 18, 24].map((h) => (
          <span
            key={h}
            className={cn("absolute", h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {hourLabel(h % 24)}
          </span>
        ))}
      </div>
      {log.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line-subtle pt-4">
          <span className="font-mono text-[11px] tracking-[1.5px] text-ink-faint uppercase">Recently</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {log.slice(0, 6).map((e) => (
              <li key={`${e.ts}-${e.text}`} className="flex gap-3">
                <span className="w-[104px] flex-none text-ink-faint tabular-nums max-sm:w-[64px]">
                  {when(e.ts, now)}
                </span>
                <span className="flex min-w-0 items-start gap-2 text-pretty text-ink-muted">
                  {e.kind && (
                    <span
                      aria-hidden
                      className="mt-1.5 size-2 flex-none rounded-full"
                      style={{ background: KIND_COLOR[e.kind] }}
                    />
                  )}
                  <span>
                    {e.text}
                    {e.until ? ` until ${when(e.until, e.ts)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Key({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      {children}
    </li>
  );
}

type Hover = { t: number; soc: number; w: number | null; ahead: boolean };

/** The reading (or the expected level, ahead) nearest a time. */
function nearestPoint(
  points: Point[],
  plan: [number, number][],
  preview: [number, number][],
  at: number,
): Hover | null {
  const all: Hover[] = [
    ...points.map((p) => ({ ...p, ahead: false })),
    ...(plan.length > 1 ? plan : preview).map(([t, soc]) => ({ t, soc, w: null, ahead: true })),
  ];
  let best: Hover | null = null;
  for (const p of all) if (!best || Math.abs(p.t - at) < Math.abs(best.t - at)) best = p;
  return best && Math.abs(best.t - at) <= 1800 ? best : null;
}

function Readout({ p, band, left, top }: { p: Hover; band: Band | null; left: number; top: number }) {
  const st = batteryState(p.w);
  const flip = left > 62;
  return (
    <>
      <div
        className="pointer-events-none absolute top-5 bottom-0 border-l border-dashed border-line-strong"
        style={{ left: `${left}%` }}
      />
      <span
        className="pointer-events-none absolute -mt-1 -ml-1 size-2 rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
        style={{ left: `${left}%`, top: `${top}%`, background: COLOR.battery }}
      />
      <div
        className="pointer-events-none absolute top-6 z-2 flex flex-col gap-0.5 rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-ink-inverse tabular-nums"
        style={flip ? { right: `calc(${100 - left}% + 10px)` } : { left: `calc(${left}% + 10px)` }}
      >
        <span>
          <b className="mr-1 font-semibold">{hhmm(p.t)}</b>
          {pct(p.soc)}
          {p.ahead
            ? " expected"
            : st === "charge"
              ? ` · charging ${kW(p.w)}`
              : st === "discharge"
                ? ` · discharging ${kW(p.w)}`
                : " · idle"}
        </span>
        {band && <span className="opacity-75">{band.label || KIND_LABEL[band.kind]}</span>}
      </div>
    </>
  );
}
