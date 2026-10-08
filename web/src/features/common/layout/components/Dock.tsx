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
import { cn } from "~/features/common/ui/utils";

/** The power flow right now, for the dock and the side nav: the readings (gliding to each minute's), and how to say them. */
function usePowerNow() {
  const p = useSnapshot();
  const batMode = useBatteryMode();
  const now = useNow(30_000);
  // The figures glide to each minute's reading (hooks before the early return).
  const t = {
    pv: useTween(p?.pv_power),
    l: useTween(p?.load_power),
    g: useTween(p?.grid_power),
    b: useTween(p?.battery_power),
    soc: useTween(p?.battery_soc),
  };
  if (!p) return null;
  const { pv_power: pv, grid_power: g, battery_power: b, load_power: l } = p;
  const soc = p.battery_soc ?? 0;
  const st = batteryState(b);
  const verb = gridVerb(g);
  const batVerb = st === "charge" ? "Charging" : st === "discharge" ? "Discharging" : "Idle";
  // What it's set to do, when that's anything but normal (standby, a floor, a charge, iSolarCloud…).
  const mode = batMode ? describeMode(batMode, now) : null;
  const special = mode?.special ? mode : null;
  const moving = st === "charge" || st === "discharge";
  return {
    now,
    pv,
    g,
    soc,
    st,
    verb,
    solar: kW(t.pv),
    home: `${l != null && l < 0 ? "−" : ""}${kW(t.l)}`,
    grid: kW(t.g),
    ring: `${(Math.max(0, Math.min(100, t.soc ?? soc)) * 3.6).toFixed(1)}deg`,
    battery: moving ? kW(t.b) : special?.label === "Standby" ? "Standby" : "Idle",
    arrow: st === "charge" ? "↑ " : st === "discharge" ? "↓ " : "",
    batColor: st === "charge" ? COLOR.batterySoft : st === "discharge" ? COLOR.warn : alpha(COLOR.fg, 0.75),
    label: `Power flow now: solar ${kW(pv)}, home ${kW(l)}, ${verb.toLowerCase()} ${kW(g)}, battery ${Math.round(soc)}% ${batVerb.toLowerCase()}${special ? `, ${special.label}${special.detail ? ` ${special.detail}` : ""}` : ""}. Open overview.`,
  };
}

/**
 * Mini power flow pinned to the bottom of the page on a phone, where the side nav is a menu (from tablets up it's in
 * the side nav: `NavPower`). Not on Overview, which it opens; it stays mounted so it can slide out when Overview opens
 * and back in when you leave (see `.dock`).
 */
export function Dock() {
  const f = usePowerNow();
  const onOverview = useRouterState({ select: (s) => s.location.pathname === "/" });
  // Start hidden and show on the next frame, so the first appearance slides in too.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!f) return null;
  const shown = ready && !onOverview;
  return (
    <div className="pointer-events-none fixed right-0 bottom-5 left-0 z-15 flex justify-center px-4 md:hidden">
      <Link
        to="/"
        data-shown={shown}
        inert={!shown}
        aria-hidden={!shown}
        aria-label={f.label}
        className="dock group flex max-w-full items-center gap-1.5 rounded-full border border-fg/8 bg-dock/75 py-[5px] pr-2.5 pl-[5px] whitespace-nowrap text-fg no-underline shadow-dock backdrop-blur-xl backdrop-saturate-150 hover:border-fg/15 hover:bg-dock-hover/85 hover:text-fg max-xs:gap-1 max-xs:py-1 max-xs:pr-2 max-xs:pl-1"
      >
        <DockItem icon="sun" color={COLOR.solar} v={f.solar} />
        <Conn on={(f.pv || 0) > ON} color={COLOR.solar} className="w-3.5 max-xs:w-2.5" />
        <DockItem icon="home" color={COLOR.ink} v={f.home} />
        <Conn
          on={f.g != null && Math.abs(f.g) > ON}
          rev={(f.g ?? 0) > 0}
          color={COLOR.gridLine}
          className="w-3.5 max-xs:w-2.5"
        />
        <DockItem icon="grid" color={COLOR.gridSoft} v={f.grid} />
        <span aria-hidden className="h-4 w-px flex-none bg-fg/10" />
        <span className="flex items-center gap-2 max-xs:gap-[5px]">
          <SocRing
            ring={f.ring}
            now={f.now}
            behind="var(--color-dock)"
            className="size-6 max-xs:size-[22px]"
            inner="size-[19px] max-xs:size-[17px]"
          />
          <span
            className="text-xs font-semibold tracking-[-0.2px] tabular-nums max-xs:text-[11.5px] max-xs:tracking-[-0.3px]"
            style={{ color: f.batColor }}
          >
            {f.arrow}
            {f.battery}
          </span>
        </span>
      </Link>
    </div>
  );
}

/**
 * The same power flow, always in the side nav above its live chip, opening Overview. In full, solar → home ← grid on a
 * row, with the battery under them; on the rail, a column of each reading under its icon.
 */
export function NavPower({ full }: { full: boolean }) {
  const f = usePowerNow();
  const onOverview = useRouterState({ select: (s) => s.location.pathname === "/" });
  if (!f) return null;
  const box =
    "group flex flex-none rounded-xl border border-fg/6 bg-fg/4 text-ink no-underline transition-colors duration-200 hover:border-fg/12 hover:bg-fg/6 hover:text-ink";
  if (!full)
    return (
      // Only where the rail has the height for it, as it doesn't scroll.
      <Link
        to="/"
        aria-label={f.label}
        title={f.label}
        aria-current={onOverview ? "page" : undefined}
        className={cn(box, "w-12 flex-col items-center gap-2.5 py-2.5 [@media(max-height:1040px)]:hidden")}
      >
        <RailItem icon="sun" color={COLOR.solar} v={f.solar} />
        <RailItem icon="home" color={COLOR.ink} v={f.home} />
        <RailItem icon="grid" color={COLOR.gridSoft} v={f.grid} />
        <span className="flex flex-col items-center gap-1">
          <SocRing ring={f.ring} now={f.now} behind="var(--color-canvas)" className="size-6" inner="size-[19px]" />
          <span className="text-[10.5px] font-semibold tabular-nums">{Math.round(f.soc)}%</span>
        </span>
      </Link>
    );
  return (
    <Link
      to="/"
      aria-label={f.label}
      aria-current={onOverview ? "page" : undefined}
      className={cn(box, "flex-col gap-3 px-2 pt-2.5 pb-2")}
    >
      <span className="flex items-start">
        <FlowItem icon="sun" color={COLOR.solar} k="Solar" v={f.solar} />
        <Conn on={(f.pv || 0) > ON} color={COLOR.solar} className="mt-2.5 min-w-2 flex-1" />
        <FlowItem icon="home" color={COLOR.ink} k="Home" v={f.home} />
        <Conn
          on={f.g != null && Math.abs(f.g) > ON}
          rev={(f.g ?? 0) > 0}
          color={COLOR.gridLine}
          className="mt-2.5 min-w-2 flex-1"
        />
        {/* "Importing" and "Exporting" are too wide for the column; the dot shows which way it goes. */}
        <FlowItem icon="grid" color={COLOR.gridSoft} k={f.verb.replace(/ing$/, "")} v={f.grid} />
      </span>
      <span className="flex items-center gap-2 border-t border-fg/6 px-0.5 pt-2">
        <SocRing ring={f.ring} now={f.now} behind="var(--color-canvas)" className="size-6" inner="size-[19px]" />
        <span className="text-[12.5px] font-medium text-ink-soft">Battery {Math.round(f.soc)}%</span>
        <span
          className="ml-auto text-[12.5px] font-semibold tracking-[-0.2px] tabular-nums"
          style={{ color: f.batColor }}
        >
          {f.arrow}
          {f.battery}
        </span>
      </span>
    </Link>
  );
}

/** An icon on a soft tint of its colour. */
function Tint({ icon, color, className }: { icon: IconName; color: string; className: string }) {
  return (
    <span
      className={cn("flex flex-none items-center justify-center rounded-full", className)}
      style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
    >
      <Icon name={icon} size={14} />
    </span>
  );
}

function DockItem({ icon, color, v }: { icon: IconName; color: string; v: string }) {
  return (
    <span className="flex items-center gap-1.5 max-xs:gap-[5px]">
      <Tint icon={icon} color={color} className="size-6 max-xs:size-[22px]" />
      <span className="text-xs font-semibold tracking-[-0.2px] tabular-nums max-xs:text-[11.5px] max-xs:tracking-[-0.3px]">
        {v}
      </span>
    </span>
  );
}

/** A column of the nav's flow: its icon, the reading under it, and what it is. A fixed width, so the row holds still. */
function FlowItem({ icon, color, k, v }: { icon: IconName; color: string; k: string; v: string }) {
  return (
    <span className="flex w-12 flex-none flex-col items-center gap-1 leading-none">
      <Tint icon={icon} color={color} className="mb-0.5 size-7" />
      <span className="text-[12.5px] font-semibold tracking-[-0.2px] whitespace-nowrap tabular-nums">{v}</span>
      <span className="text-[10.5px] text-ink-faint">{k}</span>
    </span>
  );
}

function RailItem({ icon, color, v }: { icon: IconName; color: string; v: string }) {
  return (
    <span className="flex flex-col items-center gap-1">
      <Tint icon={icon} color={color} className="size-6" />
      <span className="text-[10.5px] font-semibold tracking-[-0.2px] whitespace-nowrap tabular-nums">{v}</span>
    </span>
  );
}

/** The battery icon in a ring filled to its charge, with a badge for any mode it's set to. */
function SocRing({
  ring,
  now,
  behind,
  className,
  inner,
}: {
  ring: string;
  now: number;
  /** The colour around it, for the badge's cut-out edge. */
  behind: string;
  className: string;
  inner: string;
}) {
  return (
    <span
      className={cn("soc-ring relative flex flex-none items-center justify-center rounded-full", className)}
      style={{ "--deg": ring } as React.CSSProperties}
    >
      <span className={cn("flex items-center justify-center rounded-full bg-dock-inset text-battery-soft", inner)}>
        <Icon name="battery" size={13} />
      </span>
      <ModeBadge now={now} ring={behind} className="-right-1.5 -bottom-1.5 size-4" />
    </span>
  );
}

/** A short track between two items; the dot travels in the direction power flows. */
function Conn({ on, rev, color, className }: { on: boolean; rev?: boolean; color: string; className: string }) {
  return (
    <span
      aria-hidden
      className={cn("dock-conn", className)}
      data-on={on}
      data-rev={!!rev}
      style={{ "--c": color } as React.CSSProperties}
    />
  );
}
