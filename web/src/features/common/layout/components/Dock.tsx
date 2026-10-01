import { Link, useRouterState } from "@tanstack/react-router";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { batteryState, gridVerb, ON } from "~/features/common/energy/utils";
import { kW } from "~/features/common/formatting/utils/number";

/** Mini power flow pinned to the bottom of every page except Overview. Opens Overview. */
export function Dock() {
  const p = useSnapshot();
  const onOverview = useRouterState({ select: (s) => s.location.pathname === "/" });
  if (onOverview || !p) return null;
  const { pv_power: pv, grid_power: g, battery_power: b, load_power: l } = p;
  const soc = p.battery_soc ?? 0;
  const st = batteryState(b);
  const verb = gridVerb(g);
  const batVerb = st === "charge" ? "Charging" : st === "discharge" ? "Discharging" : "Idle";
  return (
    <Link
      to="/"
      aria-label={`Power flow now: solar ${kW(pv)}, home ${kW(l)}, ${verb.toLowerCase()} ${kW(g)}, battery ${Math.round(soc)}% ${batVerb.toLowerCase()}. Open overview.`}
      className="fixed bottom-5 left-1/2 z-15 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/12 bg-popover py-1.5 pr-3.5 pl-1.5 whitespace-nowrap text-white no-underline shadow-dock transition-[transform,box-shadow] duration-200 ease-out-soft hover:-translate-y-0.5 hover:text-white max-sm:bottom-3 max-sm:gap-1.5 max-sm:py-[5px] max-sm:pr-2.5 max-sm:pl-[5px] max-xs:gap-1 max-xs:py-1 max-xs:pr-2 max-xs:pl-1"
    >
      <DockItem icon="sun" iconBg="#ff7a1a" k="Solar" v={kW(pv)} />
      <Conn on={(pv || 0) > ON} color="#ff7a1a" />
      <DockItem
        icon="home"
        iconBg="#ffffff"
        iconColor="#111111"
        k="Home"
        v={`${l != null && l < 0 ? "−" : ""}${kW(l)}`}
      />
      <Conn on={g != null && Math.abs(g) > ON} rev={(g ?? 0) > 0} color="#9a9aa3" />
      <DockItem icon="grid" iconBg="#3a3d44" k={verb} v={kW(g)} />
      <span aria-hidden className="h-6 w-px flex-none bg-white/14 max-sm:h-[18px]" />
      <span className="flex items-center gap-2 max-xs:gap-[5px]">
        <span
          className="soc-ring flex size-7 flex-none items-center justify-center rounded-full max-sm:size-6 max-xs:size-[22px]"
          style={{ "--deg": `${(Math.max(0, Math.min(100, soc)) * 3.6).toFixed(1)}deg` } as React.CSSProperties}
        >
          <span className="flex size-[22px] items-center justify-center rounded-full bg-popover max-sm:size-[18px] max-xs:size-4">
            <Icon name="battery" size={14} className="max-xs:size-3" />
          </span>
        </span>
        <DockText
          k={`Battery ${Math.round(soc)}%`}
          v={`${st === "charge" ? "↑ " : st === "discharge" ? "↓ " : ""}${st === "charge" || st === "discharge" ? kW(b) : "Idle"}`}
          color={st === "charge" ? "#8fa6ff" : st === "discharge" ? "#ffc777" : "rgba(255,255,255,0.75)"}
        />
      </span>
      <span aria-hidden className="ml-0.5 text-lg text-white/50 max-sm:hidden">
        ›
      </span>
    </Link>
  );
}

function DockItem({
  icon,
  iconBg,
  iconColor = "#ffffff",
  k,
  v,
}: {
  icon: IconName;
  iconBg: string;
  iconColor?: string;
  k: string;
  v: string;
}) {
  return (
    <span className="flex items-center gap-2 max-xs:gap-[5px]">
      <span
        className="flex size-7 flex-none items-center justify-center rounded-full max-sm:size-6 max-xs:size-[22px]"
        style={{ background: iconBg, color: iconColor }}
      >
        <Icon name={icon} size={14} className="max-xs:size-3" />
      </span>
      <DockText k={k} v={v} />
    </span>
  );
}

function DockText({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <span className="flex flex-col gap-0.5 leading-none">
      <span className="font-mono text-[9px] tracking-[1px] text-white/65 uppercase max-sm:hidden">{k}</span>
      <span
        className="text-sm font-semibold tracking-[-0.2px] tabular-nums max-sm:text-xs max-xs:text-[11.5px] max-xs:tracking-[-0.3px]"
        style={{ color }}
      >
        {v}
      </span>
    </span>
  );
}

/** A short track between two items; the dot travels in the direction power flows. */
function Conn({ on, rev, color }: { on: boolean; rev?: boolean; color: string }) {
  return (
    <span
      aria-hidden
      className="dock-conn w-7 max-sm:w-3.5 max-xs:w-2.5"
      data-on={on}
      data-rev={!!rev}
      style={{ "--c": color } as React.CSSProperties}
    />
  );
}
