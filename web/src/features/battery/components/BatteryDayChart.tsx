import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { controlHistoryQuery } from "~/features/battery/api";
import type {
  BatteryPlan,
  ControlKind,
  ControlRecord,
  ControlRequest,
  Outlook,
  OutlookDay,
  OutsideKind,
} from "~/features/battery/types";
import { KIND_COLOR, KIND_LABEL, recordLabel } from "~/features/battery/utils";
import { batteryState, reserveOf } from "~/features/common/energy/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import type { SystemInfo } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { DragBand, timeTicks, useDragRange, useZoom, ZoomOut } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";

const W = 1000;
const H = 260;
const TOP = 26; // room for the controls' labels
const BOTTOM = 8;
const y = (soc: number) => TOP + (1 - Math.max(0, Math.min(100, soc)) / 100) * (H - TOP - BOTTOM);

type Point = { t: number; soc: number; w: number | null };
type Line = [number, number][];
type Band = {
  kind: ControlKind | OutsideKind;
  from: number;
  to: number;
  label: string;
  floor: number | null;
  ahead: boolean;
};

/** The controls as shaded stretches of the day: a running one reaches to where it's set to end (or, set until it's
 * stopped, to the end of the outlook), the part still to come drawn fainter. */
function bandsOf(
  controls: ControlRecord[],
  plan: BatteryPlan | null,
  horizon: number,
  start: number,
  end: number,
  now: number,
) {
  const out: Band[] = [];
  for (const c of controls) {
    // What something else set runs on as far as now: when it'll end isn't known.
    const outside = c.kind === "isolarcloud" || c.kind === "external" || c.kind === "elsewhere";
    const stop = c.ended_at ?? (outside ? now : (c.until ?? plan?.ends_at ?? horizon));
    const from = Math.max(c.started_at, start);
    const past = Math.min(c.ended_at ?? now, stop, end);
    const label = recordLabel(c);
    if (past > from) out.push({ kind: c.kind, from, to: past, label, floor: c.floor, ahead: false });
    const ahead = Math.max(now, from);
    if (c.ended_at == null && Math.min(stop, end) > ahead)
      out.push({
        kind: c.kind,
        from: ahead,
        to: Math.min(stop, end),
        label: past > from ? "" : label,
        floor: c.floor,
        ahead: true,
      });
  }
  return out;
}

/** The bands to name over the chart: the newest first, leaving out an older one whose name would run into it (its
 * shading and the tooltip still say what ran). */
function labelled(bands: Band[], X: (t: number) => number): Band[] {
  const kept: Band[] = [];
  for (const b of [...bands].filter((b) => b.label).sort((a, z) => z.from - a.from))
    if (!kept.length || X(kept[kept.length - 1].from) - X(b.from) > 140) kept.push(b);
  return kept;
}

/** The part of a line from `from` to `to`, with the point either side so it runs on to the edges (clipped there). */
function slice<T>(pts: T[], at: (p: T) => number, from: number, to: number): T[] {
  const a = pts.findIndex((p) => at(p) >= from);
  if (a < 0) return [];
  let b = pts.findIndex((p) => at(p) > to);
  if (b < 0) b = pts.length;
  return pts.slice(Math.max(0, a - 1), Math.min(pts.length, b + 1));
}

/** The level a line has nearest a time (within half an hour), or null. */
function levelAt(line: Line, t: number): number | null {
  let best: [number, number] | null = null;
  for (const p of line) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return best && Math.abs(best[0] - t) <= 1800 ? best[1] : null;
}

/**
 * A day of the battery: its level through the day, the controls that ran shaded behind it (a raised reserve drawn
 * as a line), and from now on, through tomorrow, what's expected as things are set (`outlook`), what the control
 * being set up would make of it (`preview`), and while a control runs, what running as normal would (`without`).
 * The arrows step back through earlier days, and on to tomorrow; under the chart, the day's lowest level, grid
 * energy and cost, each way.
 */
export function BatteryDayChart({
  s,
  now,
  plan,
  outlook,
  preview,
  draft,
  className,
}: {
  s: SystemInfo | undefined;
  now: number;
  /** What the control in effect will do (its end, and running as normal instead). */
  plan: BatteryPlan | null;
  outlook: Outlook | null;
  preview: BatteryPlan | null;
  /** The control being set up, as its settings are this moment. */
  draft: ControlRequest | null;
  className?: string;
}) {
  const today = midnight(now);
  const tomorrow = addDays(today, 1);
  const [day, setDay] = useState(today);
  const start = day;
  const end = addDays(day, 1);
  const isToday = day === today;
  const future = day > today;
  const { data } = useQuery({
    ...historyQuery({
      start,
      end: isToday ? Math.min(end, now + 60) : end,
      points: 288,
      fields: ["battery_soc", "battery_power"],
      live: isToday,
    }),
    enabled: !future,
    placeholderData: keepPreviousData,
  });
  const { data: hist } = useQuery({ ...controlHistoryQuery(start, end), placeholderData: keepPreviousData });

  const zoom = useZoom(start, end); // a stretch of the day dragged across, shown on its own
  const { from, to } = zoom;
  const X = (t: number) => ((t - from) / (to - from)) * W; // not held to the stretch: the plot clips it
  const points = useMemo<Point[]>(() => {
    if (!data || future) return [];
    const sr = data.series;
    return sr.t
      .map((t, i) => ({ t, soc: sr.battery_soc?.[i] ?? null, w: sr.battery_power?.[i] ?? null }))
      .filter((p): p is Point => p.soc != null && p.t >= start && p.t < end);
  }, [data, future, start, end]);
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

  // From now on (today and tomorrow only): what's expected, what the control being set up would do, and while a
  // control runs, running as normal instead.
  const within = (o: Outlook | null | undefined): Line =>
    o && day <= tomorrow ? o.points.filter(([t]) => t >= Math.max(now - 60, start) && t <= end) : [];
  const expected = within(outlook);
  const previewLine = within(draft ? preview?.ahead : null);
  const without = plan ? within(plan.ahead_normal) : [];
  const horizon = outlook?.points[outlook.points.length - 1]?.[0] ?? now;

  const bands = bandsOf(hist?.controls ?? [], plan, horizon, start, end, now);
  if (draft) {
    // The control being set up, over the stretch it would run: drawn from its settings as they are this moment (the
    // worked-out end of a charge once it's in).
    const from = Math.max(now, start);
    const charged = draft.kind === "charge" && preview?.kind === "charge" ? preview.ends_at : null;
    const to = Math.min(draft.until ?? charged ?? horizon, end);
    const shown = { kind: draft.kind, floor: draft.floor ?? null, target: draft.target ?? null };
    if (to > from) bands.push({ ...shown, from, to, label: recordLabel(shown), ahead: true });
  }
  // The worked-out line lags the sliders a moment: dimmed until it's for what they show.
  const stale =
    !!preview &&
    !!draft &&
    (preview.floor !== (draft.floor ?? null) ||
      preview.target !== (draft.target ?? null) ||
      preview.kind !== draft.kind);
  const reserve = reserveOf(s);

  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const range = useDragRange(from, to, zoom.zoom);
  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHoverAt(from + ((e.clientX - r.left) / r.width) * (to - from));
  };
  const inView = points.filter((p) => p.t >= from && p.t <= to);
  const hover = hoverAt == null ? null : readingNear(inView, hoverAt);
  const hoverBand = hoverAt == null ? null : (bands.find((b) => b.from <= hoverAt && hoverAt < b.to) ?? null);

  // What's drawn of the stretch shown: the lines run on to its edges, the controls are cut off at them.
  const cut = (l: Line) => slice(l, ([t]) => t, from, to);
  const drawn = runs.map((r) => slice(r, (p) => p.t, from, to)).filter((r) => r.length > 1);
  const seen = bands.filter((b) => b.to > from && b.from < to);
  const named = labelled(
    seen.map((b) => ({ ...b, from: Math.max(b.from, from), to: Math.min(b.to, to) })),
    X,
  );
  const nowIn = isToday && now >= from && now <= to;

  const path = (pts: Line) => pts.map(([t, v], i) => `${i ? "L" : "M"}${X(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const kinds = [...new Set(bands.map((b) => b.kind))];
  const key = dateKey(day);
  const title = isToday ? "Today" : day === tomorrow ? "Tomorrow" : shortDay.format(new Date(day * 1000));

  return (
    <Card aria-labelledby="h-bday" className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-bday">{title}</h2>
          <span className="text-[13px] text-ink-muted">
            {future
              ? "What the battery is expected to do, from the forecast"
              : isToday
                ? "The battery's level, what it was set to do, and what's expected"
                : "The battery's level, and what it was set to do"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {zoom.zoomed && <ZoomOut from={from} to={to} onClick={zoom.reset} />}
          <Button variant="icon" aria-label="The day before" onClick={() => setDay(addDays(day, -1))}>
            <Icon name="chevL" size={16} />
          </Button>
          <Button
            variant="icon"
            aria-label={isToday ? "Tomorrow's forecast" : "The day after"}
            disabled={day >= tomorrow}
            onClick={() => setDay(addDays(day, 1))}
            className="disabled:opacity-40"
          >
            <Icon name="chevR" size={16} />
          </Button>
        </div>
      </div>

      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-xs text-ink-muted">
        {!future && (
          <Key swatch={<span className="h-0.5 w-4 rounded-full" style={{ background: COLOR.battery }} />}>Level</Key>
        )}
        {expected.length > 1 && (
          <Key swatch={<span className="w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.battery }} />}>
            Expected
          </Key>
        )}
        {previewLine.length > 1 && (
          <Key swatch={<span className="w-4 border-t-2 border-dotted" style={{ borderColor: COLOR.batterySoft }} />}>
            If you start it
          </Key>
        )}
        {without.length > 1 && (
          <Key swatch={<span className="w-4 border-t-2 border-dashed" style={{ borderColor: alpha(COLOR.fg, 0.4) }} />}>
            Without it
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
        <li className="text-ink-faint max-md:hidden">Drag across the chart to look closer</li>
      </ul>

      <div
        onPointerMove={(e) => {
          onPoint(e);
          range.handlers.onPointerMove?.(e);
        }}
        onPointerDown={(e) => {
          onPoint(e);
          range.handlers.onPointerDown?.(e);
        }}
        onPointerUp={range.handlers.onPointerUp}
        onPointerCancel={range.handlers.onPointerCancel}
        onPointerLeave={() => setHoverAt(null)}
        className="relative h-[260px] cursor-crosshair touch-pan-y max-sm:h-[200px]"
      >
        <DragBand band={range.band} />
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 block size-full overflow-hidden"
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
          {seen.map((b, i) => (
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
          {drawn.map((r, i) => (
            <path
              key={`a${i}`}
              d={`${path(r.map((p) => [p.t, p.soc]))} L${X(r[r.length - 1].t).toFixed(1)} ${H} L${X(r[0].t).toFixed(1)} ${H} Z`}
              fill="url(#bday-fill)"
            />
          ))}
          {drawn.map((r, i) => (
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
          {without.length > 1 && (
            <path
              d={path(cut(without))}
              fill="none"
              strokeWidth="1.5"
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.fg, 0.4) }}
            />
          )}
          {expected.length > 1 && (
            <path
              d={path(cut(expected))}
              fill="none"
              strokeWidth="2"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: COLOR.battery }}
            />
          )}
          {previewLine.length > 1 && (
            <path
              d={path(cut(previewLine))}
              fill="none"
              strokeWidth="2.5"
              strokeDasharray="1 5"
              opacity={stale ? 0.4 : 1}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: COLOR.batterySoft }}
            />
          )}
          {nowIn && (
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
        {named.map((b, i) => {
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
        {nowIn && (
          <span
            className="pointer-events-none absolute -bottom-5 -translate-x-1/2 text-[10px] font-semibold text-ink-muted"
            style={{ left: `${(X(now) / W) * 100}%` }}
          >
            Now
          </span>
        )}
        {hoverAt != null && !range.dragging && (
          <Readout
            at={hover?.t ?? hoverAt}
            left={(X(hover?.t ?? hoverAt) / W) * 100}
            reading={hover}
            expected={hover ? null : levelAt(expected, hoverAt)}
            preview={levelAt(previewLine, hoverAt)}
            without={levelAt(without, hoverAt)}
            band={hoverBand}
            dot={hover ? (y(hover.soc) / H) * 100 : null}
          />
        )}
      </div>
      <div className="relative mt-1 h-4 font-mono text-[10px] text-ink-faint tabular-nums">
        {timeTicks(from, to, 6).map((k, i) => (
          <span
            key={k.t}
            className={cn(
              "absolute whitespace-nowrap",
              k.left < 3 ? "" : k.left > 97 ? "-translate-x-full" : "-translate-x-1/2",
              zoom.zoomed && k.odd && i !== 0 && "max-md:hidden",
            )}
            style={{ left: `${k.left}%` }}
          >
            {k.label}
          </span>
        ))}
      </div>

      {day >= today && day <= tomorrow && outlook?.days[key] && (
        <DaySummary
          title={isToday ? "Rest of today" : "Tomorrow"}
          expected={outlook.days[key]}
          preview={preview?.ahead.days[key] ?? null}
          without={plan?.ahead_normal.days[key] ?? null}
        />
      )}
    </Card>
  );
}

/** The day's lowest level, grid energy and cost: as expected, and as it would be with the control being set up, or
 * without the one in effect. */
function DaySummary({
  title,
  expected,
  preview,
  without,
}: {
  title: string;
  expected: OutlookDay;
  preview: OutlookDay | null;
  without: OutlookDay | null;
}) {
  const row = (name: string, d: OutlookDay, swatch: ReactNode, vs?: OutlookDay) => {
    const diff = vs ? d.cost - vs.cost : 0;
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-5 text-[13px] tabular-nums max-sm:grid-cols-[minmax(0,1fr)_auto_auto] max-sm:gap-x-3">
        <span className="flex items-center gap-2 text-ink-muted">
          {swatch}
          {name}
        </span>
        <span title={`Lowest at ${hhmm(d.min_at)}`}>
          lowest <b className="font-semibold">{pct(d.min_soc)}</b>
        </span>
        <span className="max-sm:hidden">{kWh(d.grid_kwh)} from the grid</span>
        <span className="text-right">
          <b className="font-semibold">{money(d.cost)}</b>
          {vs && Math.abs(diff) >= 0.05 && (
            <span className={cn("ml-1.5 text-xs", diff > 0 ? "text-warn" : "text-good")}>
              {diff > 0 ? "+" : "−"}
              {money(Math.abs(diff))}
            </span>
          )}
        </span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-canvas/60 px-4 py-3 light:bg-canvas">
      <span className="font-mono text-[11px] tracking-[1.5px] text-ink-faint uppercase">
        {title}, from the forecast
      </span>
      {row(
        "Expected",
        expected,
        <span className="w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.battery }} />,
      )}
      {preview &&
        row(
          "If you start it",
          preview,
          <span className="w-4 border-t-2 border-dotted" style={{ borderColor: COLOR.batterySoft }} />,
          expected,
        )}
      {without &&
        row(
          "Without it",
          without,
          <span className="w-4 border-t-2 border-dashed" style={{ borderColor: alpha(COLOR.fg, 0.4) }} />,
          expected,
        )}
    </div>
  );
}

function Key({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      {children}
    </li>
  );
}

/** The reading nearest a time (within half an hour), or null. */
function readingNear(points: Point[], at: number): Point | null {
  let best: Point | null = null;
  for (const p of points) if (!best || Math.abs(p.t - at) < Math.abs(best.t - at)) best = p;
  return best && Math.abs(best.t - at) <= 1800 ? best : null;
}

function Readout({
  at,
  left,
  reading,
  expected,
  preview,
  without,
  band,
  dot,
}: {
  at: number;
  left: number;
  reading: Point | null;
  expected: number | null;
  preview: number | null;
  without: number | null;
  band: Band | null;
  dot: number | null;
}) {
  if (!reading && expected == null && preview == null && without == null) return null;
  const st = batteryState(reading?.w);
  const flip = left > 62;
  return (
    <>
      <div
        className="pointer-events-none absolute top-5 bottom-0 border-l border-dashed border-line-strong"
        style={{ left: `${left}%` }}
      />
      {dot != null && (
        <span
          className="pointer-events-none absolute -mt-1 -ml-1 size-2 rounded-full shadow-[0_0_0_2px_var(--color-surface)]"
          style={{ left: `${left}%`, top: `${dot}%`, background: COLOR.battery }}
        />
      )}
      <div
        className="pointer-events-none absolute top-6 z-2 flex flex-col gap-0.5 rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-ink-inverse tabular-nums"
        style={flip ? { right: `calc(${100 - left}% + 10px)` } : { left: `calc(${left}% + 10px)` }}
      >
        <b className="font-semibold">{hhmm(at)}</b>
        {reading && (
          <span>
            {pct(reading.soc)}
            {st === "charge"
              ? ` · charging ${kW(reading.w)}`
              : st === "discharge"
                ? ` · discharging ${kW(reading.w)}`
                : " · idle"}
          </span>
        )}
        {expected != null && <span>Expected {pct(expected)}</span>}
        {preview != null && <span>If you start it {pct(preview)}</span>}
        {without != null && <span className="opacity-75">Without it {pct(without)}</span>}
        {band && <span className="opacity-75">{band.label || KIND_LABEL[band.kind]}</span>}
      </div>
    </>
  );
}
