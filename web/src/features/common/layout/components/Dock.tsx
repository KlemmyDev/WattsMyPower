import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Glint } from "~/features/common/ui/components/Glint";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { batteryState, gridVerb, ON } from "~/features/common/energy/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { ModeBadge } from "~/features/battery/components/ModeBadge";
import { useBatteryMode, useNoBattery } from "~/features/battery/hooks";
import { describeMode } from "~/features/battery/utils";
import { useNow } from "~/features/common/time/hooks";
import { cn } from "~/features/common/ui/utils";

/** The power flow right now, for the dock and the side nav: the readings (gliding to each minute's), and how to say them. */
function usePowerNow() {
  const p = useSnapshot();
  const batMode = useBatteryMode();
  const none = useNoBattery();
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
  const bat = none
    ? ""
    : `, battery ${Math.round(soc)}% ${batVerb.toLowerCase()}${special ? `, ${special.label}${special.detail ? ` ${special.detail}` : ""}` : ""}`;
  return {
    now,
    /** Whether to show the battery: not on a system known to have none (solar only). */
    hasBattery: !none,
    pv,
    g,
    b,
    l,
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
    label: `Power flow now: solar ${kW(pv)}, home ${kW(l)}, ${verb.toLowerCase()} ${kW(g)}${bat}. Open overview.`,
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
        {f.hasBattery && (
          <>
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
          </>
        )}
      </Link>
    </div>
  );
}

/**
 * The same power flow, always at the foot of the side nav, opening Overview. In full, a small circuit: solar, the
 * battery (if there is one), home and grid as nodes on one wire, each lit while it's in use, with sparks running along
 * the wire the way the power goes. On the rail, a column of each reading under its icon, joined the same way.
 */
export function NavPower({ full }: { full: boolean }) {
  const f = usePowerNow();
  const onOverview = useRouterState({ select: (s) => s.location.pathname === "/" });
  if (!f) return null;
  const pv = f.pv ?? 0;
  const g = f.g ?? 0;
  const box =
    "group flex flex-none rounded-xl border border-fg/6 bg-fg/4 text-ink no-underline transition-colors duration-200 hover:border-fg/12 hover:bg-fg/6 hover:text-ink";
  // Grid power runs toward home when importing (up the rail, or left along the circuit).
  const grid = <Seg on={Math.abs(g) > ON} rev={g > 0} color={COLOR.gridLine} w={g} vertical={!full} />;
  if (!full)
    return (
      // Only where the rail has the height for it, as it doesn't scroll.
      <Link
        to="/"
        aria-label={f.label}
        title={f.label}
        aria-current={onOverview ? "page" : undefined}
        className={cn(box, "w-12 flex-col items-center gap-1.5 py-2.5 [@media(max-height:1040px)]:hidden")}
      >
        <RailItem icon="sun" color={COLOR.solar} v={f.solar} on={f.pv} />
        <Seg on={pv > ON} color={COLOR.solar} w={pv} vertical />
        <RailItem icon="home" color={COLOR.ink} v={f.home} on={f.l} />
        {grid}
        <RailItem icon="grid" color={COLOR.gridSoft} v={f.grid} on={f.g} />
        {f.hasBattery && (
          <span className="mt-1 flex flex-col items-center gap-1">
            <SocRing ring={f.ring} now={f.now} behind="var(--color-nav)" className="size-6" inner="size-[19px]" />
            <Glint value={`${Math.round(f.soc)}%`} className="text-[10.5px] font-semibold tabular-nums" />
          </span>
        )}
      </Link>
    );
  // What reaches home from solar and the battery (less, or the other way, when the grid's charging the battery).
  const side = pv + (f.hasBattery ? (f.b ?? 0) : 0);
  const batColor = f.st === "discharge" ? COLOR.warn : COLOR.batterySoft;
  const nodes = [
    <Node key="solar" icon="sun" color={COLOR.solar} lit={pv > ON} v={f.solar} k="Solar" on={f.pv} />,
    f.hasBattery && (
      <Node
        key="battery"
        icon="battery"
        color={batColor}
        lit={f.st === "charge" || f.st === "discharge"}
        v={`${Math.round(f.soc)}%`}
        k="Battery"
        badge={<ModeBadge now={f.now} ring="var(--color-nav)" className="-right-2.5 -bottom-1 size-4" />}
      />
    ),
    <Node key="home" icon="home" color={COLOR.ink} lit v={f.home} k="Home" on={f.l} />,
    // "Importing" and "Exporting" are too wide for the column; the spark shows which way it goes.
    <Node
      key="grid"
      icon="grid"
      color={COLOR.gridSoft}
      lit={Math.abs(g) > ON}
      v={f.grid}
      k={f.verb.replace(/ing$/, "")}
      on={f.g}
    />,
  ].filter(Boolean);
  // The wire runs from the first node's middle to the last's.
  const inset = `${50 / nodes.length}%`;
  return (
    <Link
      to="/"
      aria-label={f.label}
      aria-current={onOverview ? "page" : undefined}
      className={cn(box, "px-1.5 pt-2.5 pb-2")}
    >
      <span className="relative grid w-full" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
        <span aria-hidden className="absolute top-[22.5px] flex" style={{ left: inset, right: inset }}>
          <Seg on={pv > ON} color={COLOR.solar} w={pv} />
          {f.hasBattery && (
            <Seg
              on={Math.abs(side) > ON}
              rev={side < 0}
              color={f.st === "discharge" ? batColor : side < 0 ? COLOR.gridLine : COLOR.solar}
              w={side}
            />
          )}
          {grid}
        </span>
        {nodes}
      </span>
    </Link>
  );
}

/** A node of the nav's circuit: its icon, a dot lit in its colour while it's in use, its reading and what it is. */
function Node({
  icon,
  color,
  lit,
  v,
  k,
  on,
  badge,
}: {
  icon: IconName;
  color: string;
  lit: boolean;
  v: string;
  k: string;
  /** The reading `v` glides from, which glints as it changes. */
  on?: unknown;
  badge?: React.ReactNode;
}) {
  return (
    <span
      data-lit={lit || undefined}
      className="nav-node flex min-w-0 flex-col items-center gap-[5px] leading-none"
      style={{ "--c": color } as React.CSSProperties}
    >
      <span className="relative flex">
        <Icon name={icon} size={14} className="nav-node-icon" />
        {badge}
      </span>
      <span aria-hidden className="nav-node-dot" />
      <Glint
        value={v}
        on={on}
        className="mt-px text-xs font-semibold tracking-[-0.2px] whitespace-nowrap tabular-nums"
      />
      <span className="-mt-px text-[10.5px] whitespace-nowrap text-ink-faint">{k}</span>
    </span>
  );
}

/**
 * A stretch of the nav's wire between two of the flow's readings, with a spark running along it the way the power goes
 * (`rev` back toward the start), quicker the more of it there is (`w`, in watts).
 */
function Seg({
  on,
  rev,
  color,
  w,
  vertical,
}: {
  on: boolean;
  rev?: boolean;
  color: string;
  w: number;
  vertical?: boolean;
}) {
  // A lap in half-kilowatt steps, so the spark doesn't change pace at every reading.
  const lap = Math.max(0.7, 2.6 - Math.min(Math.round(Math.abs(w) / 500) / 2, 5) * 0.38);
  return (
    <span
      aria-hidden
      className="nav-seg"
      data-on={on || undefined}
      data-rev={rev || undefined}
      data-vertical={vertical || undefined}
      style={{ "--c": color, "--lap": `${lap.toFixed(2)}s` } as React.CSSProperties}
    />
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

function RailItem({ icon, color, v, on }: { icon: IconName; color: string; v: string; on: unknown }) {
  return (
    <span className="flex flex-col items-center gap-1">
      <Tint icon={icon} color={color} className="size-6" />
      <Glint
        value={v}
        on={on}
        className="text-[10.5px] font-semibold tracking-[-0.2px] whitespace-nowrap tabular-nums"
      />
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
