import { useState, type PointerEvent } from "react";
import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { ChartTooltip, HoverLine, TooltipRow } from "~/features/common/ui/components/ChartHover";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh, pct } from "~/features/common/formatting/utils/number";
import { hourIcon, hourIconColor } from "~/features/common/weather/utils";
import { BH, next24, PH, W } from "~/features/overview/utils/next24";

type N24 = NonNullable<ReturnType<typeof next24>>;
type Hour = N24["hours"][number];

const plot = "absolute inset-0 size-full overflow-visible";
const line = { vectorEffect: "non-scaling-stroke", strokeLinejoin: "round" } as const;

/** A dot on a chart line at the hovered hour. `top` is a percentage of the plot's height. */
const Dot = ({ left, top, color }: { left: number; top: number; color: string }) => (
  <span
    className="pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_#141414]"
    style={{ left: `${left}%`, top: `${top}%`, background: color }}
  />
);

/** What the forecast expects in the hovered hour. */
function HourTooltip({ hour, first, width }: { hour: Hour; first: boolean; width: number }) {
  const { h } = hour;
  const icon = hourIcon(h);
  const tomorrow = new Date(hour.from * 1000).toDateString() !== new Date().toDateString();
  const g = h.grid_kwh;
  return (
    <ChartTooltip left={hour.left} flip={hour.left > 60} width={width} className="top-[30px]">
      <div className="flex items-end justify-between gap-2 font-medium text-ink">
        <span className="flex flex-col">
          {tomorrow && <span className="text-[11px] font-normal text-ink-faint">Tomorrow</span>}
          {first ? "Now" : hhmm(hour.from)} to {hhmm(hour.to)}
        </span>
        <span className="flex items-center gap-1 text-ink-soft">
          <span style={{ color: hourIconColor(icon) }}>
            <Icon name={icon} size={14} />
          </span>
          {h.temp != null ? `${Math.round(h.temp)}°` : ""}
        </span>
      </div>
      <TooltipRow label="Solar" value={kW(h.pv_kw * 1000)} color="#ffb547" />
      <TooltipRow label="Home use" value={kW(h.load_kw * 1000)} color="#f5f5f5" />
      <TooltipRow label={`Battery at ${hhmm(hour.to)}`} value={pct(hour.socEnd)} color="#6f8cff" />
      <TooltipRow
        label={g > 0.05 ? "From the grid" : g < -0.05 ? "To the grid" : "Grid"}
        value={Math.abs(g) > 0.05 ? kWh(Math.abs(g)) : "Idle"}
      />
    </ChartTooltip>
  );
}

/** Next 24 hours: how much solar and battery cover, the key moments, weather, solar / home use and battery charts, and totals. */
export function Next24Card({
  p,
  s,
  f,
  now,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
}) {
  const n = f ? next24(f, p, s, now) : null;
  return (
    <Card aria-labelledby="h-next">
      <CardHeader
        title="Next 24 hours"
        id="h-next"
        action={
          <ButtonLink to="/forecast" variant="link">
            View forecast
          </ButtonLink>
        }
      />
      {!n ? (
        <div className="text-[15px] leading-[23px] text-pretty text-[#c8c8c8]">
          {f === undefined
            ? "Loading forecast"
            : "Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned off."}
        </div>
      ) : (
        <>
          <Coverage n={n} />
          {n.moments.length > 0 && <Moments n={n} />}
          <Charts n={n} />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-px overflow-hidden rounded-2xl bg-line-subtle">
            {n.stats.map(([label, value, color]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1 bg-surface-inset px-4 py-3.5">
                <span className="overflow-hidden text-xs text-ellipsis whitespace-nowrap text-ink-dim">{label}</span>
                <span className="text-xl font-medium tabular-nums" style={{ color }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** Headline and a bar of how much of the day's use solar and the battery cover. */
function Coverage({ n }: { n: N24 }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-lg leading-[26px] font-medium text-pretty text-ink">{n.headline}</div>
      <div className="flex flex-col gap-1.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-[#3a3a3e]">
          <div className="bg-battery" style={{ width: `${n.cover.toFixed(1)}%` }} />
        </div>
        <div className="flex justify-between gap-3 text-xs text-ink-dim tabular-nums">
          <span className="whitespace-nowrap">Solar and battery · {Math.round(n.cover)}%</span>
          <span className="whitespace-nowrap">Grid · {n.gridKwh}</span>
        </div>
      </div>
    </div>
  );
}

const Num = ({ num, color, className }: { num: number; color: string; className?: string }) => (
  <span
    className={cn("flex items-center justify-center rounded-full font-bold text-ink-inverse", className)}
    style={{ background: color }}
  >
    {num}
  </span>
);

/** The numbered list of what happens when. */
function Moments({ n }: { n: N24 }) {
  return (
    <ol className="flex flex-col">
      {n.moments.map((m) => (
        <li
          key={m.num}
          className="grid grid-cols-[24px_76px_minmax(0,1fr)] items-center gap-3 border-t border-line-subtle py-3"
        >
          <Num num={m.num} color={m.color} className="size-6 text-xs" />
          <span className="flex flex-col gap-px">
            <span className="text-[17px] leading-5 font-medium text-ink tabular-nums">{m.time}</span>
            <span className="text-[11px] text-[#7a7a7a]">{m.day}</span>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-[19px] font-medium text-ink">{m.title}</span>
            <span className="text-xs leading-[17px] text-ink-dim">{m.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Weather, then solar / home use and battery level on a shared time axis, with the moments marked across both. */
function Charts({ n }: { n: N24 }) {
  const [hover, setHover] = useState<Hour | null>(null);
  const [width, setWidth] = useState(0);
  const onPoint = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    setWidth(r.width);
    setHover(n.hours.reduce((a, b) => (Math.abs(b.left - x) < Math.abs(a.left - x) ? b : a)));
  };
  const nights = (h: number) =>
    n.nights.map((r) => (
      <rect key={r.x} x={r.x.toFixed(1)} y="0" width={r.w.toFixed(1)} height={h} fill="rgba(255,255,255,0.025)" />
    ));
  const base = (h: number) => (
    <line x1="0" x2={W} y1={h - 2} y2={h - 2} stroke="rgba(255,255,255,0.12)" vectorEffect="non-scaling-stroke" />
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-8">
        {n.weather.map(({ at, h }) => {
          const icon = hourIcon(h);
          return (
            <div key={at} title={hhmm(at)} className="flex flex-col items-center gap-1">
              <span style={{ color: hourIconColor(icon) }}>
                <Icon name={icon} size={18} />
              </span>
              <span className="text-xs text-ink-soft tabular-nums">
                {h.temp != null ? `${Math.round(h.temp)}°` : "–"}
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="relative flex cursor-crosshair touch-pan-y flex-col gap-1.5 pt-[30px]"
        onPointerMove={onPoint}
        onPointerDown={onPoint}
        onPointerLeave={() => setHover(null)}
      >
        {n.moments.map((m) => (
          <div
            key={m.num}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0"
            style={{ left: `${m.left.toFixed(1)}%` }}
          >
            <Num num={m.num} color={m.color} className="absolute top-0 left-0 size-5 -translate-x-1/2 text-[11px]" />
            <span className="absolute top-6 bottom-0 left-0 border-l border-dashed border-line-strong" />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 text-xs text-ink-dim">
          <span className="flex gap-3.5">
            <span className="flex items-center gap-1.5">
              <i className="size-2.5 rounded-[3px] bg-solar/60" />
              Solar
            </span>
            <span className="flex items-center gap-1.5">
              <i className="w-3.5 border-t-[1.5px] border-ink" />
              Home use
            </span>
          </span>
          <span className="tabular-nums">{n.guideKw} kW</span>
        </div>
        <div className="relative h-[110px]">
          <svg viewBox={`0 0 ${W} ${PH}`} preserveAspectRatio="none" aria-hidden="true" className={plot}>
            {nights(PH)}
            <line
              x1="0"
              x2={W}
              y1={n.guideY.toFixed(1)}
              y2={n.guideY.toFixed(1)}
              stroke="rgba(255,255,255,0.08)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
            <path d={`${n.pvPath} L${W} ${PH - 2} L0 ${PH - 2} Z`} fill="rgba(255,181,71,0.32)" />
            <path d={n.pvPath} fill="none" stroke="#ffb547" strokeWidth="1.75" {...line} />
            <path d={n.loadPath} fill="none" stroke="#f5f5f5" strokeWidth="1.5" {...line} />
            {base(PH)}
          </svg>
          {hover && (
            <>
              <Dot left={hover.left} top={hover.pvTop} color="#ffb547" />
              <Dot left={hover.left} top={hover.loadTop} color="#f5f5f5" />
            </>
          )}
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-[3px] bg-battery" />
            Battery level
          </span>
          <span className="tabular-nums">Reserve {n.reserve}%</span>
        </div>
        <div className="relative h-14">
          <svg viewBox={`0 0 ${W} ${BH}`} preserveAspectRatio="none" aria-hidden="true" className={plot}>
            {nights(BH)}
            <line
              x1="0"
              x2={W}
              y1={n.fullY}
              y2={n.fullY}
              stroke="rgba(255,255,255,0.08)"
              vectorEffect="non-scaling-stroke"
            />
            <path d={`${n.socPath} L${W} ${BH - 2} L0 ${BH - 2} Z`} fill="rgba(111,140,255,0.2)" />
            <path d={n.socPath} fill="none" stroke="#6f8cff" strokeWidth="2.25" {...line} />
            <line
              x1="0"
              x2={W}
              y1={n.reserveY.toFixed(1)}
              y2={n.reserveY.toFixed(1)}
              stroke="rgba(255,255,255,0.3)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
            {base(BH)}
          </svg>
          {hover && <Dot left={hover.left} top={hover.socTop} color="#6f8cff" />}
        </div>
        {hover && (
          <>
            <HoverLine left={hover.left} className="top-6" />
            <HourTooltip hour={hover} first={hover === n.hours[0]} width={width} />
          </>
        )}
      </div>
      <div className="relative h-3.5">
        {n.ticks.map((tk, i) => (
          <span
            key={tk.left}
            className={cn(
              "absolute font-mono text-[10px] whitespace-nowrap text-[#7a7a7a]",
              i === 0 ? "" : i === n.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
            )}
            style={{ left: `${tk.left}%` }}
          >
            {tk.label}
          </span>
        ))}
      </div>
    </div>
  );
}
