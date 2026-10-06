import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { carsQuery } from "~/features/car/api";
import { carName, paintOf } from "~/features/car/utils";
import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import { clock, duration } from "~/features/common/formatting/utils/date";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { batteryState, gridVerb } from "~/features/common/energy/utils";
import { ModeBadge } from "~/features/battery/components/ModeBadge";
import { DASH, kW, powerParts } from "~/features/common/formatting/utils/number";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { HouseScene, houseAnchors, type Anchor } from "~/features/overview/components/HouseScene";
import { houseOptions } from "~/features/overview/utils/house/options";

/** The power flow drawing with live values, drawn under the current weather. */
export function PowerFlowHero({
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
  return (
    <section
      aria-label="Power flow"
      className="relative col-span-12 overflow-hidden rounded-[28px] max-md:rounded-[20px] max-md:bg-surface light:border light:border-line-subtle"
    >
      {p ? (
        <Scene p={p} s={s} f={f} now={now} />
      ) : (
        <div className="relative aspect-[1200/600] w-full bg-[#dcebff] max-md:aspect-[4/3]" />
      )}
    </section>
  );
}

function Scene({
  p,
  s,
  f,
  now,
}: {
  p: Snapshot;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
}) {
  const wx = liveWeather(p, f, now, !!s?.temp_unit_f);
  const { data: cars } = useQuery(carsQuery);
  const flows = {
    pv: (p.pv_power || 0) / 1000,
    grid: (p.grid_power || 0) / 1000,
    bat: -(p.battery_power || 0) / 1000,
    soc: (p.battery_soc || 0) / 100,
    tesla: 0,
    conn: false,
    // With a second inverter, each one's own share, so each gets its own line from the roof.
    pvEach: p.pv2_power != null ? [(p.pv1_power ?? 0) / 1000, p.pv2_power / 1000] : undefined,
  };
  const { labels } = houseAnchors();
  const dark = wx.mode === "night" || wx.mode === "storm";
  const { grid_power: g, battery_power: b, load_power: l } = p;
  // The figures glide to each minute's reading; the scene's flows and states follow the reading itself.
  const tween = { pv: useTween(p.pv_power), g: useTween(g), l: useTween(l), b: useTween(b) };
  const parts = (w: number | null | undefined) => (w == null ? [DASH, "kW"] : powerParts(w));
  const [pv, grid, home] = [parts(tween.pv), parts(tween.g), parts(tween.l)];
  const st = batteryState(b);
  const batRate = st === "charge" ? `↑ ${kW(tween.b)}` : st === "discharge" ? `↓ ${kW(tween.b)}` : "0 W";
  const batColor = st === "charge" ? COLOR.batterySoft : st === "discharge" ? COLOR.warn : alpha(COLOR.fg, 0.6);

  return (
    <>
      {/* No background under the scene: it covers the box, and a light one would show as a fringe
          around the rounded corners against a dark sky. */}
      <div className="relative aspect-[1200/600] w-full whitespace-nowrap max-md:aspect-[4/3]">
        <HouseScene
          flows={flows}
          sky={wx.mode}
          cover={wx.cover}
          house={houseOptions(
            s,
            (cars ?? []).map((c) => c.car.car_park),
          )}
          cars={(cars ?? []).map((c) => ({
            body: c.car.car_body,
            paint: paintOf(c.car.car_colour).hex,
            label: [carName(c), c.level && `${Math.round(c.level.soc)}%`].filter(Boolean).join(" · "),
            href: `/settings/integrations/car/${c.id}`,
          }))}
          links
        />
        {/* The heading and weather chip follow the sky (dark at night and in storms), not the theme. */}
        <div className="absolute top-7 left-8 z-1 flex max-w-[300px] flex-col items-start gap-3.5 whitespace-normal max-md:top-3 max-md:left-3.5">
          <div className="flex flex-col gap-1 max-md:hidden">
            <h2
              className={cn(
                "text-[36px] leading-10 font-normal tracking-[-1px] transition-colors duration-600",
                dark ? "text-white" : "text-[#111111]",
              )}
            >
              Power flow
            </h2>
            <span
              className={cn(
                "text-sm leading-5 transition-colors duration-600",
                dark ? "text-white/75" : "text-[#111111]/65",
              )}
            >
              Live from your inverter · updated every minute
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={chip(dark)}>
              <Icon name={liveWeatherIcon(wx)} size={16} />
              <span>{wx.label}</span>
            </div>
            <NextPoll dark={dark} />
          </div>
        </div>
      </div>

      {/* Value pills: over the scene at its edges on wide screens, in a panel under it on phones. */}
      <div className="pointer-events-none absolute inset-0 max-md:pointer-events-auto max-md:static max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:p-3">
        <ValuePill
          side="right"
          pos={labels.solar}
          className="max-md:order-1"
          icon={<Icon name="sun" size={18} />}
          iconStyle={{ background: COLOR.solarDeep }}
          k="Solar"
          v={pv[0]}
          unit={pv[1]}
          title={
            p.pv2_power != null
              ? `Hybrid ${kW(p.pv1_power)} · ${s?.pv2?.model || "Second inverter"} ${kW(p.pv2_power)}`
              : undefined
          }
        />
        <ValuePill
          side="left"
          pos={labels.grid}
          className="max-md:order-3"
          icon={<Icon name="grid" size={18} />}
          iconStyle={{ background: COLOR.grid }}
          k={gridVerb(g)}
          v={grid[0]}
          unit={grid[1]}
        />
        <ValuePill
          side="left"
          pos={labels.home}
          className="max-md:order-2"
          icon={<Icon name="home" size={18} />}
          iconStyle={{ background: COLOR.pillInk, color: COLOR.pill }}
          k="Home"
          v={`${l != null && l < 0 ? "−" : ""}${home[0]}`}
          unit={home[1]}
        />
        <ValuePill
          side="right"
          pos={labels.battery}
          className="max-md:order-4"
          icon={
            <>
              <div className="flex size-[30px] items-center justify-center rounded-full bg-pill text-pill-ink max-md:bg-popover max-2xs:size-[25px] light:max-md:bg-canvas">
                <Icon name="battery" size={18} />
              </div>
              <ModeBadge now={now} ring={COLOR.pill} />
            </>
          }
          iconClassName="soc-ring relative"
          iconStyle={{ "--ring": COLOR.batteryRing, "--deg": `${(flows.soc * 360).toFixed(1)}deg` } as CSSProperties}
          k="Battery"
          v={String(Math.round(p.battery_soc ?? 0))}
          unit="%"
        >
          {/* the Battery card just below shows the charge rate, so phones drop this */}
          <div className="ml-0.5 flex flex-col gap-[3px] border-l border-fg/14 pl-3 leading-none max-md:hidden">
            <PillKey>{st === "charge" ? "Charging" : st === "discharge" ? "Discharging" : "Idle"}</PillKey>
            <b className="text-[17px] font-semibold tabular-nums" style={{ color: batColor }}>
              {batRate}
            </b>
          </div>
        </ValuePill>
      </div>
    </>
  );
}

const chip = (dark: boolean) =>
  cn(
    "flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2 text-[13px] font-medium backdrop-blur-[8px]",
    dark ? "bg-white/14 text-white" : "bg-white/75 text-[#111111]",
  );

/** Counts down to the collector's next read of the inverters, ticking on its own so the scene doesn't re-render each second. */
function NextPoll({ dark }: { dark: boolean }) {
  const st = useLive();
  // Its own clock, to the fraction of a second: whole seconds a second apart would run up to two behind.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, []);
  const next = st?.next_poll;
  if (!st || next == null) return null;
  const left = next - now;
  // Long past: the status has stopped arriving (the collector's unreachable), so there's nothing to count to.
  if (left < -30) return null;
  const interval = st.poll_interval || 60;
  const retry = !!st.error;
  const share = Math.min(1, Math.max(0, left / interval));
  return (
    <div
      className={chip(dark)}
      title={
        retry
          ? "The inverter didn't answer; the next try backs off"
          : `The inverters are read every ${duration(interval)}`
      }
    >
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden className="-rotate-90">
        <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
        <circle
          cx={8}
          cy={8}
          r={6}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          pathLength={1}
          strokeDasharray={`${share} 1`}
          className="transition-[stroke-dasharray] duration-250 ease-linear"
        />
      </svg>
      <span className="tabular-nums" role="timer" aria-live="off">
        {left > 0 ? `${retry ? "Retry" : "Next poll"} in ${clock(left)}` : "Polling now…"}
      </span>
    </div>
  );
}

const PillKey = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[10px] tracking-[1px] text-pill-ink/70 uppercase">{children}</span>
);

/** A value pill; it sits at the left or right edge, level with where its leader line starts. */
function ValuePill({
  side,
  pos,
  className,
  icon,
  iconClassName,
  iconStyle,
  k,
  v,
  unit,
  title,
  children,
}: {
  side: "left" | "right";
  pos: Anchor;
  className: string;
  icon: ReactNode;
  iconClassName?: string;
  iconStyle: CSSProperties;
  k: string;
  v: string;
  unit: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      title={title}
      style={{ top: pos.top }}
      className={cn(
        "pointer-events-auto absolute flex -translate-y-1/2 items-center gap-2.5 rounded-full border border-fg/14 bg-pill py-1.5 pr-4 pl-1.5 text-pill-ink shadow-pill max-xl:scale-80",
        side === "left" ? "left-6 origin-left" : "right-6 origin-right",
        "max-md:static max-md:min-w-0 max-md:translate-y-0 max-md:scale-100 max-md:rounded-2xl max-md:border-fg/8 max-md:bg-popover max-md:py-2 max-md:pr-3 max-md:pl-2 max-md:shadow-none max-2xs:gap-2 light:max-md:bg-canvas",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-[38px] flex-none items-center justify-center rounded-full text-white max-2xs:size-8",
          iconClassName,
        )}
        style={iconStyle}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-1 leading-none">
        <PillKey>{k}</PillKey>
        <span className="text-[22px] font-semibold tracking-[-0.6px] tabular-nums max-md:text-xl max-2xs:text-lg">
          {v}
          <small className="ml-[3px] text-[13px] font-medium tracking-normal text-pill-ink/70">{unit}</small>
        </span>
      </div>
      {children}
    </div>
  );
}
