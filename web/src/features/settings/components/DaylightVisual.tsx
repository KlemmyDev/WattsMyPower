import { useMemo, useRef, useState, type PointerEvent } from "react";
import { dayMonth, hhmm } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { partsOf, siteTime } from "~/features/common/time/utils";
import { ChartTooltip, HoverLine, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { dayLength, sunDay, type SunDay } from "~/features/settings/utils/sun";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Today's sun: an arc from sunrise to sunset over the horizon, the sun on it now, and the day's length. */
function SunArc({ today, now }: { today: SunDay; now: number }) {
  const { rise, set, noon } = today;
  // The arc's height follows the day's length: a short winter day is a low arc.
  const peak = 18 + (today.hours / 24) * 70;
  const W = 420;
  const H = 110;
  const base = 96;
  const pt = (f: number) => [20 + f * (W - 40), base - Math.sin(Math.PI * f) * peak] as const;
  const path = Array.from({ length: 41 }, (_, i) => pt(i / 40))
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const up = rise != null && set != null && now >= rise && now <= set;
  const f = rise != null && set != null ? (now - rise) / (set - rise) : 0;
  const [sx, sy] = pt(Math.min(Math.max(f, 0), 1));
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Today's sun">
        <defs>
          <linearGradient id="sun-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={COLOR.solar} stopOpacity="0.22" />
            <stop offset="1" stopColor={COLOR.solar} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L${W - 20},${base} L20,${base} Z`} fill="url(#sun-sky)" />
        <path d={path} fill="none" stroke={alpha(COLOR.solar, 0.5)} strokeWidth="2" strokeDasharray="3 4" />
        {up && (
          <path
            d={Array.from({ length: 41 }, (_, i) => pt((i / 40) * Math.min(Math.max(f, 0), 1)))
              .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke={COLOR.solar}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}
        <line x1="6" x2={W - 6} y1={base} y2={base} stroke={COLOR.gridLine} strokeWidth="1" />
        {up ? (
          <circle cx={sx} cy={sy} r="7" fill={COLOR.solar} stroke="var(--color-surface)" strokeWidth="3" />
        ) : (
          <circle cx={W / 2} cy={base + 1} r="5" fill={COLOR.moon} />
        )}
      </svg>
      <div className="grid grid-cols-3 text-[13px] tabular-nums">
        <span className="flex flex-col">
          <span className="text-xs text-ink-muted">Sunrise</span>
          {rise != null ? hhmm(rise) : "—"}
        </span>
        <span className="flex flex-col items-center">
          <span className="text-xs text-ink-muted">Solar noon</span>
          {hhmm(noon)}
        </span>
        <span className="flex flex-col items-end">
          <span className="text-xs text-ink-muted">Sunset</span>
          {set != null ? hhmm(set) : "—"}
        </span>
      </div>
    </div>
  );
}

type Day = SunDay & { t: number };

/**
 * Daylight through the year: each day's hours of it as an area, the months along the bottom, today marked, and the
 * longest and shortest days named. Hovering a day says its sunrise, sunset and length.
 */
function YearOfDaylight({ days, today }: { days: Day[]; today: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const hours = days.map((d) => d.hours);
  const lo = Math.floor(Math.min(...hours)) - 1;
  const hi = Math.ceil(Math.max(...hours)) + 1;
  const W = 300;
  const H = 120;
  const x = (i: number) => (i / (days.length - 1)) * W;
  const y = (h: number) => H - ((h - lo) / (hi - lo)) * H;
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.hours).toFixed(1)}`).join(" ");
  const longest = days.reduce((a, d) => (d.hours > a.hours ? d : a));
  const shortest = days.reduce((a, d) => (d.hours < a.hours ? d : a));
  const ti = days.findIndex(
    (d) => partsOf(d.t).month === partsOf(today).month && partsOf(d.t).day === partsOf(today).day,
  );

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (days.length - 1));
    setHover(Math.min(Math.max(i, 0), days.length - 1));
  };
  const h = hover != null ? days[hover] : null;
  const left = hover != null ? (hover / (days.length - 1)) * 100 : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px]">
        <span>
          <span className="text-ink-muted">Longest </span>
          <span className="tabular-nums">{dayLength(longest.hours)}</span>
          <span className="text-ink-faint"> · {dayMonth(longest.t)}</span>
        </span>
        <span>
          <span className="text-ink-muted">Shortest </span>
          <span className="tabular-nums">{dayLength(shortest.hours)}</span>
          <span className="text-ink-faint"> · {dayMonth(shortest.t)}</span>
        </span>
      </div>
      <div
        ref={box}
        className="relative touch-pan-y"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-[120px] w-full"
          role="img"
          aria-label="Hours of daylight through the year"
        >
          {[lo + 1, (lo + hi) / 2, hi - 1].map((g) => (
            <line
              key={g}
              x1="0"
              x2={W}
              y1={y(g)}
              y2={y(g)}
              stroke={COLOR.gridLine}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={`${line} L${W},${H} L0,${H} Z`} fill={alpha(COLOR.solar, 0.16)} />
          <path d={line} fill="none" stroke={COLOR.solar} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Today, and its dot on the line (kept round however the chart stretches). */}
        {ti >= 0 && (
          <>
            <div
              className="pointer-events-none absolute top-0 bottom-0 border-l border-ink/40"
              style={{ left: `${(ti / (days.length - 1)) * 100}%` }}
            />
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
              style={{
                left: `${(ti / (days.length - 1)) * 100}%`,
                top: `${(y(days[ti].hours) / H) * 100}%`,
                background: COLOR.solar,
              }}
            />
          </>
        )}
        {[lo + 1, (lo + hi) / 2, hi - 1].map((g) => (
          <span
            key={g}
            className="pointer-events-none absolute right-0 -translate-y-full pb-0.5 text-[10px] text-ink-faint tabular-nums"
            style={{ top: `${(y(g) / H) * 100}%` }}
          >
            {g} h
          </span>
        ))}
        {h && (
          <>
            <HoverLine left={left} />
            <ChartTooltip left={left} flip={left > 50} width={box.current?.clientWidth}>
              <span className="font-semibold">{dayMonth(h.t)}</span>
              <TooltipRow label="Daylight" value={dayLength(h.hours)} color={COLOR.solar} />
              <TooltipRow label="Sunrise" value={h.rise != null ? hhmm(h.rise) : "—"} />
              <TooltipRow label="Sunset" value={h.set != null ? hhmm(h.set) : "—"} />
            </ChartTooltip>
          </>
        )}
      </div>
      <div className="grid grid-cols-12 text-center text-[10px] text-ink-faint">
        {MONTHS.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Settings → Location, the picture: today's sun at the place (sunrise, solar noon, sunset, and where it is now) and
 * how the daylight changes through the year, all worked out from the coordinates.
 */
export function DaylightVisual({ lat, lon }: { lat: number; lon: number }) {
  const now = useNow(60_000);
  const year = partsOf(now).year;
  const days = useMemo(
    () =>
      Array.from({ length: 365 }, (_, i) => {
        const t = siteTime(year, 1, 1 + i, 12);
        return { t, ...sunDay(t, lat, lon) };
      }),
    [year, lat, lon],
  );
  const p = partsOf(now);
  const today = sunDay(siteTime(p.year, p.month, p.day, 12), lat, lon);
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[34px] leading-10 font-light tracking-[-1px] tabular-nums">{dayLength(today.hours)}</span>
        <span className="text-[13px] text-ink-muted">of daylight today</span>
      </div>
      <SunArc today={today} now={now} />
      <div className="flex flex-col gap-2 border-t border-line-subtle pt-5">
        <span className="text-[13px] font-semibold">Through the year</span>
        <YearOfDaylight days={days} today={now} />
      </div>
    </>
  );
}
