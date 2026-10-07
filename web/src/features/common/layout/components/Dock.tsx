import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { batteryState, gridVerb, ON } from "~/features/common/energy/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { ModeBadge } from "~/features/battery/components/ModeBadge";
import { useBatteryMode } from "~/features/battery/hooks";
import { describeMode } from "~/features/battery/utils";
import { useNow } from "~/features/common/time/hooks";

/**
 * Mini power flow pinned to the bottom of every page except Overview, which it opens. It stays
 * mounted so it can slide out when Overview opens and back in when you leave (see `.dock`).
 */
export function Dock() {
  const p = useSnapshot();
  const batMode = useBatteryMode();
  const now = useNow(30_000);
  const onOverview = useRouterState({ select: (s) => s.location.pathname === "/" });
  // Start hidden and show on the next frame, so the first appearance slides in too.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // The figures glide to each minute's reading (hooks before the early return).
  const t = {
    pv: useTween(p?.pv_power),
    l: useTween(p?.load_power),
    g: useTween(p?.grid_power),
    b: useTween(p?.battery_power),
    soc: useTween(p?.battery_soc),
  };
  if (!p) return null;
  const shown = ready && !onOverview;
  const { pv_power: pv, grid_power: g, battery_power: b, load_power: l } = p;
  const soc = p.battery_soc ?? 0;
  const st = batteryState(b);
  const verb = gridVerb(g);
  const batVerb = st === "charge" ? "Charging" : st === "discharge" ? "Discharging" : "Idle";
  // What it's set to do, when that's anything but normal (standby, a floor, a charge, iSolarCloud…).
  const mode = batMode ? describeMode(batMode, now) : null;
  const special = mode?.special ? mode : null;
  return (
    // It centres in the page beside the side nav (--nav-w, from AppShell), and moves with it as a column opens.
    <div className="pointer-events-none fixed right-0 bottom-8 left-(--nav-w) z-15 flex justify-center px-4 transition-[left] duration-[450ms] ease-out-soft max-sm:bottom-5">
      <Link
        to="/"
        data-shown={shown}
        inert={!shown}
        aria-hidden={!shown}
        aria-label={`Power flow now: solar ${kW(pv)}, home ${kW(l)}, ${verb.toLowerCase()} ${kW(g)}, battery ${Math.round(soc)}% ${batVerb.toLowerCase()}${special ? `, ${special.label}${special.detail ? ` ${special.detail}` : ""}` : ""}. Open overview.`}
        className="dock group flex max-w-full items-center gap-3 rounded-full border border-fg/8 bg-dock/75 py-2 pr-4 pl-2 whitespace-nowrap text-fg no-underline shadow-dock backdrop-blur-xl backdrop-saturate-150 hover:border-fg/15 hover:bg-dock-hover/85 hover:text-fg max-sm:gap-1.5 max-sm:py-[5px] max-sm:pr-2.5 max-sm:pl-[5px] max-xs:gap-1 max-xs:py-1 max-xs:pr-2 max-xs:pl-1"
      >
        <DockItem icon="sun" color={COLOR.solar} k="Solar" v={kW(t.pv)} />
        <Conn on={(pv || 0) > ON} color={COLOR.solar} />
        <DockItem icon="home" color={COLOR.ink} k="Home" v={`${l != null && l < 0 ? "−" : ""}${kW(t.l)}`} />
        <Conn on={g != null && Math.abs(g) > ON} rev={(g ?? 0) > 0} color={COLOR.gridLine} />
        <DockItem icon="grid" color={COLOR.gridSoft} k={verb} v={kW(t.g)} />
        <span aria-hidden className="h-5 w-px flex-none bg-fg/10 max-sm:h-4" />
        <span className="flex items-center gap-2 max-xs:gap-[5px]">
          <span
            className="soc-ring relative flex size-8 flex-none items-center justify-center rounded-full max-sm:size-6 max-xs:size-[22px]"
            style={
              { "--deg": `${(Math.max(0, Math.min(100, t.soc ?? soc)) * 3.6).toFixed(1)}deg` } as React.CSSProperties
            }
          >
            <span className="flex size-[27px] items-center justify-center rounded-full bg-dock-inset text-battery-soft max-sm:size-[19px] max-xs:size-[17px]">
              <Icon name="battery" size={14} className="max-sm:size-[13px] max-xs:size-3" />
            </span>
            <ModeBadge now={now} ring="var(--color-dock)" className="-right-1.5 -bottom-1.5 max-sm:size-4" />
          </span>
          <DockText
            k={`Battery ${Math.round(soc)}%`}
            v={`${st === "charge" ? "↑ " : st === "discharge" ? "↓ " : ""}${st === "charge" || st === "discharge" ? kW(t.b) : special?.label === "Standby" ? "Standby" : "Idle"}`}
            color={st === "charge" ? COLOR.batterySoft : st === "discharge" ? COLOR.warn : alpha(COLOR.fg, 0.75)}
          />
        </span>
        <Icon
          name="chevR"
          size={16}
          className="ml-0.5 flex-none text-fg/35 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-fg/70 max-sm:hidden"
        />
      </Link>
    </div>
  );
}

/** An icon on a soft tint of its colour, with a label and value beside it. */
function DockItem({ icon, color, k, v }: { icon: IconName; color: string; k: string; v: string }) {
  return (
    <span className="flex items-center gap-2 max-xs:gap-[5px]">
      <span
        className="flex size-8 flex-none items-center justify-center rounded-full max-sm:size-6 max-xs:size-[22px]"
        style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
      >
        <Icon name={icon} size={15} className="max-sm:size-3.5 max-xs:size-3" />
      </span>
      <DockText k={k} v={v} />
    </span>
  );
}

function DockText({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <span className="flex flex-col gap-[3px] leading-none">
      <span className="text-[11px] font-medium text-fg/45 max-sm:hidden">{k}</span>
      <span
        className="text-[15px] font-semibold tracking-[-0.2px] tabular-nums max-sm:text-xs max-xs:text-[11.5px] max-xs:tracking-[-0.3px]"
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
