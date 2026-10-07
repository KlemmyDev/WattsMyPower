import { Link, useRouterState } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { batteryTone, ON } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLiveStatus, useNavColumn, useNavItems } from "~/features/common/layout/hooks";
import { sectionOf } from "~/features/common/layout/utils";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { BrandMark, Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { HomeNavColumn } from "~/features/home/components/HomeNavColumn";
import { SettingsNavColumn } from "~/features/settings/components/SettingsNavColumn";

/** Sections with a column of their own pages beside the rail. The rest have none, so their pages get the width. */
export const NAV_COLUMNS: Partial<Record<string, ComponentType>> = {
  "/home": HomeNavColumn,
  "/settings": SettingsNavColumn,
};

/** Where the column shows (the `2xl` breakpoint): below it, a section's own page links to its pages instead. */
const COLUMN_MEDIA = "(min-width: 1090px)";

/**
 * The navigation, down the left on tablets and up (phones keep the top bar). A rail of section icons, whose right edge
 * is a conductor: lit from the logo down to the page you're on (from the live dot up, for Settings), with a pulse
 * running along it. Sections with pages of their own (Home's devices, Settings' tabs) open a column beside it.
 */
export function SideNav() {
  const items = useNavItems();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = sectionOf(path);
  const [open, setOpen] = useNavColumn();
  const { state, status, now } = useLiveStatus();
  const p = useSnapshot();
  const rail = useRef<HTMLElement>(null);
  const spot = useConductor(rail, [current, items.length]);

  // The column keeps the last section's pages while it folds away on the way to a section without any.
  const [shown, setShown] = useState(current);
  if (NAV_COLUMNS[current] && shown !== current) setShown(current);
  const Column = NAV_COLUMNS[shown];
  const columnOpen = open && !!NAV_COLUMNS[current];

  // A section's icon, in that section, folds its column away and opens it again; anywhere else it goes there.
  const toggle = (to: string) => (e: React.MouseEvent) => {
    if (to === current && NAV_COLUMNS[to] && window.matchMedia(COLUMN_MEDIA).matches) {
      e.preventDefault();
      setOpen(!open);
    }
  };
  const tip = (label: string, to: string) =>
    to === current && NAV_COLUMNS[to] ? `${label} · ${open ? "hide" : "show"} pages` : label;

  const soc = p?.battery_soc;
  return (
    <>
      <nav
        ref={rail}
        aria-label="Main"
        className="fixed inset-y-0 left-0 z-30 flex w-[72px] flex-col items-center gap-4 bg-canvas py-4 max-md:hidden"
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-line-subtle" />
        {spot && (
          <>
            <span aria-hidden className="nav-tile" style={{ top: spot.to }} />
            <span
              aria-hidden
              className="nav-current"
              data-dir={spot.from > spot.to ? "up" : "down"}
              style={{ top: Math.min(spot.from, spot.to), height: Math.abs(spot.to - spot.from) }}
            />
            <span aria-hidden className="nav-node" style={{ top: spot.to }} />
          </>
        )}
        <Link
          to="/"
          data-nav-from
          aria-label="WattsMyPower, overview"
          className="flex size-11 flex-none items-center justify-center rounded-[14px] border border-fg/8 bg-linear-160 from-mark-from to-mark-to"
        >
          <BrandMark />
        </Link>
        <div className="flex flex-col items-center gap-1.5">
          {items.map((i) => (
            <RailLink
              key={i.to}
              to={i.to}
              icon={i.icon}
              label={i.label}
              tip={tip(i.label, i.to)}
              on={current === i.to}
              onClick={toggle(i.to)}
            >
              {i.to === "/home" && p?.load_power != null && p.load_power > ON && (
                <span aria-hidden className="nav-eq">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {i.to === "/battery" && soc != null && (
                <span
                  aria-hidden
                  className="nav-ring soc-ring"
                  style={
                    {
                      "--deg": `${(Math.max(0, Math.min(100, soc)) * 3.6).toFixed(1)}deg`,
                      "--ring": batteryTone(p?.battery_power),
                    } as CSSProperties
                  }
                />
              )}
            </RailLink>
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-3">
          <RailLink
            to="/settings"
            icon="settings"
            label="Settings"
            tip={tip("Settings", "/settings")}
            on={current === "/settings"}
            onClick={toggle("/settings")}
            from="below"
          />
          <span
            data-nav-from-below
            title={`${status}.`}
            className="flex flex-col items-center gap-2 pt-1 font-mono text-[11px] text-ink-dim tabular-nums"
          >
            <span className="live-dot" data-state={state} />
            {hhmm(now)}
          </span>
        </div>
      </nav>
      <aside
        aria-label="Pages in this section"
        data-open={columnOpen}
        inert={!columnOpen}
        className="fixed inset-y-0 left-[72px] z-20 w-[248px] overflow-hidden border-r border-line-subtle bg-surface transition-[width,border-color] duration-[450ms] ease-out-soft data-[open=false]:w-0 data-[open=false]:border-transparent max-2xl:hidden"
      >
        {Column && (
          <div
            key={shown}
            className="nav-column-in flex h-full w-[248px] [scrollbar-width:thin] flex-col overflow-y-auto overscroll-contain px-3 pt-6 pb-6"
          >
            <Column />
          </div>
        )}
      </aside>
    </>
  );
}

function RailLink({
  to,
  icon,
  label,
  tip,
  on,
  onClick,
  from,
  children,
}: {
  to: string;
  icon: IconName;
  label: string;
  tip: string;
  on: boolean;
  onClick: (e: React.MouseEvent) => void;
  /** Where the conductor's lit from to reach it: the logo, or the live dot for one at the bottom. */
  from?: "below";
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      data-nav={from ?? "above"}
      aria-label={label}
      aria-current={on ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "group relative z-1 flex size-[46px] flex-none items-center justify-center rounded-[15px] no-underline transition-[color,background-color,transform] duration-[260ms,200ms,160ms] active:scale-95",
        on ? "text-ink hover:text-ink" : "text-ink-muted hover:bg-fg/4 hover:text-ink",
      )}
    >
      <Icon name={icon} size={20} />
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-[62px] z-40 -translate-x-1 -translate-y-1/2 rounded-[9px] bg-ink px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-ink-inverse opacity-0 shadow-pill transition-[opacity,translate] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
      >
        {tip}
      </span>
    </Link>
  );
}

/**
 * Where the conductor runs, in pixels down the rail: `from` the logo's middle (or the live dot's, for a link at the
 * bottom) `to` the current page's icon. Re-measured on resize and once web fonts load; null on a page outside the nav.
 */
function useConductor(rail: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [spot, setSpot] = useState<{ from: number; to: number } | null>(null);
  useLayoutEffect(() => {
    const el = rail.current;
    if (!el) return;
    const mid = (n: HTMLElement | null) => (n ? n.offsetTop + n.offsetHeight / 2 : null);
    const place = () => {
      const cur = el.querySelector<HTMLElement>('[data-nav][aria-current="page"]');
      const to = mid(cur);
      if (!cur || to == null) return setSpot(null);
      const origin = el.querySelector<HTMLElement>(
        cur.dataset.nav === "below" ? "[data-nav-from-below]" : "[data-nav-from]",
      );
      setSpot({ from: mid(origin) ?? 0, to });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says what moves the current link
  }, deps);
  return spot;
}
