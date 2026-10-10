import { useId, useMemo } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { midnight } from "~/features/common/time/utils";
import { sunDay, sunHeight } from "~/features/common/time/utils/sun";
import { cn } from "~/features/common/ui/utils";

const W = 1000;
const ARC = 46; // the arc's height, the horizon along its bottom
const STEPS = 240;

/** The sun in the tooltip at `t`: "42° up", or that it isn't. */
export function sunAt(t: number, lat: number, lon: number): string {
  const h = sunHeight(t, lat, lon);
  if (h > 0) return `${Math.round(h)}° up`;
  return t < sunDay(midnight(t) + 43_200, lat, lon).noon ? "Not up yet" : "Set";
}

/**
 * The day's sun under a chart, on its time scale from `start` to `end`: how high it is through the day as an arc over
 * the horizon (solid up to now, the sun on it), the night either side shaded, and sunrise, solar noon (with how high
 * it gets) and sunset named under it. Shows when the panels could make power against when they did.
 */
export function DaylightStrip({
  start,
  end,
  now,
  lat,
  lon,
}: {
  start: number;
  end: number;
  now?: number;
  lat: number;
  lon: number;
}) {
  const id = useId().replace(/:/g, "");
  const day = useMemo(() => sunDay(midnight(start) + 43_200, lat, lon), [start, lat, lon]);
  const peak = useMemo(() => sunHeight(day.noon, lat, lon), [day.noon, lat, lon]);
  const { arc, done } = useMemo(() => {
    const top = Math.max(peak, 10);
    const pts = Array.from({ length: STEPS + 1 }, (_, i) => {
      const t = start + ((end - start) * i) / STEPS;
      return { t, x: (i / STEPS) * W, y: ARC - (sunHeight(t, lat, lon) / top) * (ARC - 3) };
    });
    const path = (list: typeof pts) =>
      list.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    return { arc: path(pts), done: now != null && now > start ? path(pts.filter((p) => p.t <= now)) : "" };
  }, [start, end, now, peak, lat, lon]);

  const left = (t: number) => ((t - start) / (end - start)) * 100;
  const within = (t: number | null): t is number => t != null && t >= start && t <= end;
  const rise = day.rise ?? (day.hours ? start : end);
  const set = day.set ?? (day.hours ? end : start);
  const nights = [
    { from: start, to: Math.min(rise, end) },
    { from: Math.max(set, start), to: end },
  ].filter((n) => n.to > n.from);
  const up = now != null && within(now) ? sunHeight(now, lat, lon) : null;
  const marks = [
    { t: day.rise, label: "Sunrise", value: day.rise != null ? hhmm(day.rise) : "" },
    { t: day.noon, label: "Solar noon", value: `${hhmm(day.noon)} · ${Math.round(peak)}°` },
    { t: day.set, label: "Sunset", value: day.set != null ? hhmm(day.set) : "" },
  ].filter((m) => within(m.t));

  return (
    <div className="flex flex-col gap-1">
      <div className="relative" style={{ height: ARC }}>
        {nights.map((n) => (
          <div
            key={n.from}
            aria-hidden
            className="absolute inset-y-0 rounded-md"
            style={{
              left: `${left(n.from)}%`,
              width: `${left(n.to) - left(n.from)}%`,
              background: alpha(COLOR.moon, 0.05),
            }}
          />
        ))}
        <svg
          viewBox={`0 0 ${W} ${ARC}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <clipPath id={`${id}-sky`}>
              <rect x="0" y={-ARC} width={W} height={ARC * 2} />
            </clipPath>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COLOR.solar} stopOpacity="0.2" />
              <stop offset="1" stopColor={COLOR.solar} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <g clipPath={`url(#${id}-sky)`}>
            <path d={`${arc} L${W} ${ARC} L0 ${ARC} Z`} fill={`url(#${id}-fill)`} />
            <path
              d={arc}
              fill="none"
              strokeWidth="1.5"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: alpha(COLOR.solar, 0.55) }}
            />
            {done && (
              <path
                d={done}
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: COLOR.solar }}
              />
            )}
          </g>
          <line x1="0" x2={W} y1={ARC} y2={ARC} vectorEffect="non-scaling-stroke" style={{ stroke: COLOR.gridLine }} />
        </svg>
        {/* Where the sun rises and sets, on the horizon, and the sun itself while it's up (kept round however the
            strip stretches). */}
        {[day.rise, day.set].filter(within).map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute bottom-0 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full"
            style={{ left: `${left(t)}%`, background: alpha(COLOR.solar, 0.7) }}
          />
        ))}
        {up != null && up > 0 && (
          <span
            aria-hidden
            className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
            style={{
              left: `${left(now!)}%`,
              top: `${((ARC - (up / Math.max(peak, 10)) * (ARC - 3)) / ARC) * 100}%`,
              background: COLOR.solar,
            }}
          />
        )}
      </div>
      <div className="relative h-7">
        {marks.map((m) => {
          const at = left(m.t!);
          return (
            <span
              key={m.label}
              className={cn(
                "absolute flex flex-col leading-tight whitespace-nowrap",
                at < 6 ? "items-start" : at > 94 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center",
              )}
              style={{ left: `${at}%` }}
            >
              <span className="text-[10.5px] text-ink-faint">{m.label}</span>
              <span className="text-[11.5px] text-ink-muted tabular-nums">{m.value}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
