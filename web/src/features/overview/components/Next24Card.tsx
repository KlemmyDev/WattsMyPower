import { Fragment } from "react";
import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { hourIcon, hourIconColor } from "~/features/common/weather/utils";
import { H, next24, W } from "~/features/overview/utils/next24";

/** Next 24 hours: story, weather, solar / home use / battery chart, and totals. */
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
      <div className="text-[15px] leading-[23px] text-pretty text-[#c8c8c8]">
        {f === undefined
          ? "Loading forecast"
          : f === null
            ? "Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned off."
            : n?.story}
      </div>
      {n && (
        <div className="flex flex-col gap-1.5">
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
          <div className="relative mt-1 h-[170px]">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="absolute inset-0 size-full overflow-visible"
            >
              <defs>
                <linearGradient id="n24pv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffb547" stopOpacity="0.5" />
                  <stop offset="1" stopColor="#ffb547" stopOpacity="0.04" />
                </linearGradient>
                <linearGradient id="n24night" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#6f8cff" stopOpacity="0.07" />
                  <stop offset="1" stopColor="#6f8cff" stopOpacity="0" />
                </linearGradient>
              </defs>
              {n.nights.map((r) => (
                <rect key={r.x} x={r.x.toFixed(1)} y="0" width={r.w.toFixed(1)} height={H} fill="url(#n24night)" />
              ))}
              <path d={`${n.pvPath} L${W} ${H - 6} L0 ${H - 6} Z`} fill="url(#n24pv)" />
              <path
                d={n.pvPath}
                fill="none"
                stroke="#ffb547"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              <path
                d={n.loadPath}
                fill="none"
                stroke="#f5f5f5"
                strokeOpacity="0.7"
                strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              <path
                d={n.socPath}
                fill="none"
                stroke="#6f8cff"
                strokeWidth="2.25"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <line
                x1="0"
                x2={W}
                y1={H - 6}
                y2={H - 6}
                stroke="rgba(255,255,255,0.08)"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {n.marks.map((m) => {
              const at = { left: `${m.left.toFixed(1)}%`, top: `${m.top.toFixed(1)}%` };
              return (
                <Fragment key={m.label}>
                  <span
                    className="absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full shadow-[0_0_0_2px_#141414]"
                    style={{ ...at, background: m.color }}
                  />
                  <span
                    className="absolute flex -translate-x-1/2 translate-y-[calc(-100%-10px)] items-center gap-[5px] rounded-full border bg-canvas px-[9px] py-[3px] text-[11px] font-semibold whitespace-nowrap text-ink tabular-nums"
                    style={{ ...at, borderColor: m.color }}
                  >
                    <i className="size-1.5 rounded-full" style={{ background: m.color }} />
                    {m.label}
                  </span>
                </Fragment>
              );
            })}
          </div>
          <div className="relative h-3.5">
            {n.ticks.map((tk, i) => (
              <span
                key={tk.left}
                className={cn(
                  "absolute font-mono text-[10px] text-ink-faint",
                  i === 0 ? "" : i === n.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: `${tk.left}%` }}
              >
                {tk.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-xs text-ink-dim">
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-2.5 flex-none rounded-[3px] bg-solar/50" />
          Solar
        </span>
        <span className="flex items-center gap-1.5">
          <i className="w-3.5 border-t-[1.5px] border-ink" />
          Home use
        </span>
        <span className="flex items-center gap-1.5">
          <i className="w-3.5 border-t-2 border-battery" />
          Battery level
        </span>
      </div>
      {n && (
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl bg-line-subtle max-[520px]:grid-cols-2">
          {n.stats.map(([label, value, color]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 bg-surface-inset p-3.5">
              <span className="overflow-hidden text-[11px] text-ellipsis whitespace-nowrap text-ink-dim">{label}</span>
              <span className="text-lg font-medium tabular-nums" style={{ color }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
