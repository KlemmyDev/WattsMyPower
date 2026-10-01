import type { CSSProperties, ReactNode } from "react";
import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { batteryState, gridVerb } from "~/features/common/energy/utils";
import { kW, kWnum } from "~/features/common/formatting/utils/number";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { HouseScene, houseAnchors, type Anchor } from "~/features/overview/components/HouseScene";

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
      className="relative col-span-12 overflow-hidden rounded-[28px] bg-[#dcebff] max-md:rounded-[20px] max-md:bg-surface"
    >
      {p ? (
        <Scene p={p} s={s} f={f} now={now} />
      ) : (
        <div className="relative aspect-[1200/600] w-full max-md:aspect-[4/3] max-md:bg-[#dcebff]" />
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
  const wx = liveWeather(p, f, now);
  const flows = {
    pv: (p.pv_power || 0) / 1000,
    grid: (p.grid_power || 0) / 1000,
    bat: -(p.battery_power || 0) / 1000,
    soc: (p.battery_soc || 0) / 100,
    tesla: 0,
    conn: false,
  };
  const { labels } = houseAnchors();
  const dark = wx.mode === "night" || wx.mode === "storm";
  const { grid_power: g, battery_power: b, load_power: l } = p;
  const st = batteryState(b);
  const batRate = st === "charge" ? `↑ ${kW(b)}` : st === "discharge" ? `↓ ${kW(b)}` : "0.0 kW";
  const batColor = st === "charge" ? "#8fa6ff" : st === "discharge" ? "#ffc777" : "rgba(255,255,255,0.6)";

  return (
    <>
      <div className="relative aspect-[1200/600] w-full whitespace-nowrap max-md:aspect-[4/3] max-md:bg-[#dcebff]">
        <HouseScene flows={flows} sky={wx.mode} cover={wx.cover} />
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
          <div
            className={cn(
              "flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2 text-[13px] font-medium backdrop-blur-[8px]",
              dark ? "bg-white/14 text-white" : "bg-white/75 text-[#111111]",
            )}
          >
            <Icon name={liveWeatherIcon(wx)} size={16} />
            <span>{wx.label}</span>
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
          iconStyle={{ background: "#ff7a1a" }}
          k="Solar"
          v={kWnum(p.pv_power)}
          unit="kW"
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
          iconStyle={{ background: "#3a3d44" }}
          k={gridVerb(g)}
          v={g == null ? "—" : kWnum(g)}
          unit="kW"
        />
        <ValuePill
          side="left"
          pos={labels.home}
          className="max-md:order-2"
          icon={<Icon name="home" size={18} />}
          iconStyle={{ background: "#ffffff", color: "#111111" }}
          k="Home"
          v={`${l != null && l < 0 ? "−" : ""}${kWnum(l)}`}
          unit="kW"
        />
        <ValuePill
          side="right"
          pos={labels.battery}
          className="max-md:order-4"
          icon={
            <div className="flex size-[30px] items-center justify-center rounded-full bg-[#111111] max-md:bg-popover max-2xs:size-[25px]">
              <Icon name="battery" size={18} />
            </div>
          }
          iconClassName="soc-ring"
          iconStyle={{ "--ring": "#2f5bff", "--deg": `${(flows.soc * 360).toFixed(1)}deg` } as CSSProperties}
          k="Battery"
          v={String(Math.round(p.battery_soc ?? 0))}
          unit="%"
        >
          {/* the Battery card just below shows the charge rate, so phones drop this */}
          <div className="ml-0.5 flex flex-col gap-[3px] border-l border-white/14 pl-3 leading-none max-md:hidden">
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

const PillKey = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[10px] tracking-[1px] text-white/70 uppercase">{children}</span>
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
        "pointer-events-auto absolute flex -translate-y-1/2 items-center gap-2.5 rounded-full border border-white/14 bg-[#111111] py-1.5 pr-4 pl-1.5 text-white shadow-pill max-xl:scale-80",
        side === "left" ? "left-6 origin-left" : "right-6 origin-right",
        "max-md:static max-md:min-w-0 max-md:translate-y-0 max-md:scale-100 max-md:rounded-2xl max-md:border-white/8 max-md:bg-popover max-md:py-2 max-md:pr-3 max-md:pl-2 max-md:shadow-none max-2xs:gap-2",
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
          <small className="ml-[3px] text-[13px] font-medium tracking-normal text-white/70">{unit}</small>
        </span>
      </div>
      {children}
    </div>
  );
}
