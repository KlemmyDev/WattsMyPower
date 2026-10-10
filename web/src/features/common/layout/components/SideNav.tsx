import { ChannelBadge } from "~/features/updates/components/ChannelBadge";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ON } from "~/features/common/energy/utils";
import { kW, kWh, pct } from "~/features/common/formatting/utils/number";
import { NavPower } from "~/features/common/layout/components/Dock";
import { NAV_DOCKED, useMedia, useNavItems, useSectionPages } from "~/features/common/layout/hooks";
import { NAV_GROUPS, sectionOf, type SectionPages } from "~/features/common/layout/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { BrandMark, Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { updatesQuery } from "~/features/updates/api";

// A section's pages say for themselves which is current (a room is, on its devices' pages). Their links only count
// themselves current on their exact page, so a link up the path ("/home") doesn't light up as well.
const EXACT = { exact: true, includeSearch: false } as const;

/**
 * The navigation from tablets up, docked down the left. From xl it's the circuit: sections in groups with a reading
 * each, on a wire lit from the top down to the page you're on, and the current section's pages branching off its node.
 * Below xl it's a rail of the same circuit with icons only, whose button opens the full circuit as a menu.
 */
export function SideNav({ onMenu }: { onMenu: () => void }) {
  const docked = useMedia(NAV_DOCKED);
  return (
    <nav
      aria-label="Main"
      data-full={docked}
      className="fixed inset-y-0 left-0 z-30 w-[72px] border-r border-line-subtle bg-nav data-[full=true]:w-[236px] data-[full=true]:overflow-hidden max-md:hidden"
    >
      {docked ? (
        <div className="h-full w-[236px]">
          <Circuit variant="full" branches />
        </div>
      ) : (
        <Circuit variant="rail" toggle={{ icon: "menu", label: "Menu", onClick: onMenu }} />
      )}
    </nav>
  );
}

/**
 * The full circuit as a menu sliding in from the left, on a phone (from its top bar) or a tablet (from the rail): the
 * sections only, as the current section's pages are always in the row of pills at the top of the page.
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Going somewhere closes it, as does Escape; the page behind doesn't scroll while it's open.
  useEffect(() => onClose(), [path, onClose]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      html.style.overflow = before;
    };
  }, [open, onClose]);
  return (
    <div
      data-open={open}
      inert={!open}
      className="group fixed inset-0 z-50 data-[open=false]:pointer-events-none xl:hidden"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/45 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-data-[open=true]:opacity-100"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="absolute inset-y-0 left-0 w-[min(288px,86vw)] -translate-x-full border-r border-line-subtle bg-nav shadow-pop transition-transform duration-[380ms] ease-out-soft group-data-[open=true]:translate-x-0"
      >
        <Circuit variant="full" toggle={{ icon: "x", label: "Close menu", onClick: onClose }} />
      </div>
    </div>
  );
}

type Toggle = { icon: IconName; label: string; onClick: () => void };

/**
 * The circuit itself: in full (labels and readings) or as a rail of icons. Docked, the current section's pages branch
 * off it (`branches`); in the menu they don't, as the page lists them in its row of pills. `toggle` is the rail's menu
 * button, or the menu's close.
 */
function Circuit({
  variant,
  toggle,
  branches = false,
}: {
  variant: "full" | "rail";
  toggle?: Toggle;
  branches?: boolean;
}) {
  const full = variant === "full";
  const items = useNavItems();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = sectionOf(path);
  const pages = useSectionPages(current);
  const p = useSnapshot();
  const live = useLive();
  const list = useRef<HTMLDivElement>(null);
  const wire = useWire(list, [path, items.length, variant, pages?.pages.length]);
  // Where the list scrolls (a short screen), the current page is kept in view: Manage's sit at the bottom. Again as
  // its room changes, as the power flow arrives below it after the page opens.
  useEffect(() => {
    const box = list.current?.parentElement;
    if (!box) return;
    const show = () => list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
    show();
    const ro = new ResizeObserver(show);
    ro.observe(box);
    return () => ro.disconnect();
  }, [path]);
  const at = items.findIndex((i) => i.to === current);
  const ev = live?.ev;
  const value: Partial<Record<string, string>> = p
    ? {
        "/solar": kW(p.pv_power),
        "/home": kW(p.load_power),
        "/battery": pct(p.battery_soc),
        "/grid": p.grid_power == null ? undefined : `${p.grid_power < -ON ? "−" : ""}${kW(p.grid_power)}`,
        "/history": kWh(p.daily_pv),
        // Each car's charge.
        "/ev": ev?.length ? ev.map((c) => pct(c.soc)).join(" · ") : undefined,
      }
    : {};

  return (
    <div
      className={cn("flex h-full flex-col", full ? "gap-5 px-3 pt-5 pb-3.5" : "items-center gap-3 px-3 pt-4 pb-3.5")}
    >
      <div className={cn("flex items-center", full ? "gap-3 px-1" : "flex-col gap-3")}>
        <Link
          to="/"
          aria-label="WattsMyPower, overview"
          className="flex flex-none items-center gap-3 text-ink no-underline hover:text-ink"
        >
          <span className="flex size-10 items-center justify-center rounded-[13px] border border-fg/8 bg-linear-160 from-mark-from to-mark-to">
            <BrandMark />
          </span>
          {full && (
            <span className="font-display text-[17px] font-semibold tracking-[-0.3px] whitespace-nowrap">
              Watts<span className="text-solar">My</span>Power
            </span>
          )}
        </Link>
        {toggle && (
          <button
            type="button"
            onClick={toggle.onClick}
            aria-label={toggle.label}
            title={toggle.label}
            className={cn(
              "flex size-8 flex-none items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-fg/6 hover:text-ink",
              full && "ml-auto",
            )}
          >
            <Icon name={toggle.icon} size={17} />
          </button>
        )}
      </div>

      {/* From xl the list scrolls on its own when a section's pages make it long; the rail never needs to, and mustn't
          clip its tooltips. */}
      <div
        className={cn(
          "min-h-0 w-full flex-1",
          full && "-mx-3 w-auto [scrollbar-width:none] overflow-y-auto overscroll-contain px-3",
        )}
      >
        <div ref={list} className="relative flex min-h-full flex-col">
          {wire && (
            <span aria-hidden className="circuit-wire" style={{ top: wire.top, height: wire.height }}>
              <span className="circuit-lit" style={{ height: wire.lit }} />
            </span>
          )}
          {items
            .filter((i) => !i.group)
            .map((i) => (
              <CircuitLink
                key={i.to}
                to={i.to}
                icon={i.icon}
                label={i.label}
                value={value[i.to]}
                color={i.color}
                full={full}
                on={current === i.to}
                lit={at >= 0 && items.indexOf(i) <= at}
              />
            ))}
          {NAV_GROUPS.map((g) => (
            <Fragment key={g}>
              <div
                className={cn(
                  "text-[11px] font-semibold tracking-[0.08em] text-ink-faint uppercase",
                  full ? "pt-4 pb-1.5 pl-[38px]" : "h-2",
                )}
              >
                {full ? g : <span className="sr-only">{g}</span>}
              </div>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <Fragment key={i.to}>
                    <CircuitLink
                      to={i.to}
                      icon={i.icon}
                      label={i.label}
                      value={value[i.to]}
                      color={i.color}
                      full={full}
                      on={current === i.to}
                      lit={at >= 0 && items.indexOf(i) <= at}
                    />
                    {branches && current === i.to && pages && <Branch pages={pages} />}
                  </Fragment>
                ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className={cn("flex flex-none flex-col gap-2", !full && "items-center")}>
        <NavPower full={full} />
        <VersionTag full={full} />
      </div>
    </div>
  );
}

function CircuitLink({
  to,
  icon,
  label,
  value,
  color,
  full,
  on,
  lit,
}: {
  to: string;
  icon: IconName;
  label: string;
  value?: string;
  /** The section's colour: its node glows in it, and the row takes a wash of it, once it's the current page. */
  color: string;
  full: boolean;
  on: boolean;
  lit?: boolean;
}) {
  return (
    <Link
      to={to}
      data-circuit-row
      data-lit={lit || undefined}
      aria-label={full ? undefined : label}
      aria-current={on ? "page" : undefined}
      style={{ "--node-c": color } as CSSProperties}
      className={cn(
        "circuit-row group relative flex h-[38px] w-full flex-none items-center gap-[11px] rounded-[11px] text-[13.5px] font-medium text-ink-muted no-underline hover:bg-fg/4 hover:text-ink aria-[current=page]:text-ink",
        // The rail doesn't scroll (its tooltips would be clipped), so on a short screen its rows close up to fit.
        full ? "pr-2.5 pl-[38px]" : "pl-[26px] [@media(max-height:820px)]:h-8",
      )}
    >
      <span aria-hidden className="circuit-node" />
      <Icon name={icon} size={16} className="circuit-icon" />
      {full ? (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {value && <span className="flex-none text-xs font-normal text-ink-faint tabular-nums">{value}</span>}
        </>
      ) : (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-[calc(100%+14px)] z-40 -translate-x-1 -translate-y-1/2 rounded-[9px] bg-ink px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-ink-inverse opacity-0 shadow-pill transition-[opacity,translate] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
        >
          {label}
          {value && <span className="ml-1.5 font-normal opacity-60">{value}</span>}
        </span>
      )}
    </Link>
  );
}

/** The current section's pages, each on an elbow off its node, under headings (rooms) where they have them. */
function Branch({ pages }: { pages: SectionPages }) {
  return (
    <div className="circuit-branch-in flex flex-col">
      {pages.pages.map((page, i) => (
        <Fragment key={page.key}>
          {page.group && page.group !== pages.pages[i - 1]?.group && (
            <div className="flex items-baseline gap-2 pt-2 pr-2.5 pb-0.5 pl-[52px] text-[11.5px] font-medium text-ink-faint">
              <span className="min-w-0 flex-1 truncate">{page.group}</span>
              {page.groupValue && <span className="flex-none tabular-nums">{page.groupValue}</span>}
            </div>
          )}
          <Link
            {...page.link}
            data-circuit-branch
            activeOptions={EXACT}
            aria-current={page.active ? "page" : undefined}
            style={{ "--node-c": page.color } as CSSProperties}
            className="relative flex h-[31px] flex-none items-center gap-2 rounded-[9px] pr-2.5 pl-[52px] text-[13px] text-ink-faint no-underline transition-colors duration-150 hover:text-ink aria-[current=page]:text-ink"
          >
            <span aria-hidden className="circuit-elbow" />
            <span aria-hidden className="circuit-sub-node" />
            <span className="min-w-0 flex-1 truncate">{page.label}</span>
            {page.value && <span className="flex-none text-[11.5px] tabular-nums">{page.value}</span>}
          </Link>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Which version this is, and the release channel the install follows ("Nightly", "Beta"; nothing on Stable): under
 * the power flow, or on the rail the channel alone (the version in its tooltip). When GitHub has a newer one, a link to System → Updates says so
 * (on the rail, a dot on the tag).
 */
function VersionTag({ full }: { full: boolean }) {
  const app = useLive()?.app;
  const updates = useQuery(updatesQuery).data;
  // The commit this page was loaded with: once the server's is another (it's been updated), the page is out of date.
  const [loadedWith, setLoadedWith] = useState<string | null | undefined>(undefined);
  if (loadedWith === undefined && app) setLoadedWith(app.commit);
  if (!app) return null;
  const stale = !!app.commit && loadedWith != null && app.commit !== loadedWith;
  if (stale)
    return (
      <button
        type="button"
        onClick={() => window.location.reload()}
        title={`Updated to ${app.version}: reload for the new dashboard`}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-xl border border-good/30 bg-good-subtle font-sans font-medium text-good",
          full ? "px-3 py-2 text-[12.5px]" : "px-1.5 py-0.5 text-[10px]",
        )}
      >
        {full ? (
          <>
            <span aria-hidden className="size-1.5 flex-none rounded-full bg-good" />
            Updated: reload
            <span className="ml-auto font-normal tabular-nums opacity-75">v{app.version}</span>
          </>
        ) : (
          "Reload"
        )}
      </button>
    );
  const channel = updates?.channel ?? null;
  const newer = updates?.available ? updates.latest : null;
  const title = `WattsMyPower ${app.version}${channel ? `, on the ${channel} channel` : ""}${newer ? ". A newer version is available." : ""}`;
  const pill = channel && <ChannelBadge channel={channel} />;
  return full ? (
    <>
      {newer && (
        <Link
          to="/settings/updates"
          className="flex items-center gap-2 rounded-xl border border-brand/25 bg-brand-subtle px-3 py-2 text-[12.5px] font-medium text-brand no-underline transition-colors hover:border-brand/45 hover:text-brand"
        >
          <span aria-hidden className="size-1.5 flex-none rounded-full bg-brand" />
          Update available
          <span className="ml-auto font-normal tabular-nums opacity-75">
            {/* The same version with newer commits: how many, rather than the version it already is. */}
            {newer.version !== app.version
              ? `v${newer.version}`
              : newer.changes
                ? `${newer.changes} ${newer.changes === 1 ? "change" : "changes"}`
                : ""}
          </span>
        </Link>
      )}
      <div title={title} className="flex items-center justify-between px-1 text-[11px] text-ink-faint tabular-nums">
        <span>v{app.version}</span>
        {pill}
      </div>
    </>
  ) : (
    <Link
      to={newer ? "/settings/updates" : "/settings"}
      title={title}
      aria-label={title}
      className="relative flex no-underline"
    >
      {pill || <span className="font-mono text-[9.5px] text-ink-faint">v{app.version}</span>}
      {newer && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 size-2 rounded-full bg-brand shadow-[0_0_0_2px_var(--color-nav)]"
        />
      )}
    </Link>
  );
}

/**
 * Where the wire runs, in pixels down the list: from the first section's node to the last node on it (the last
 * section's, or the last of its pages when they're open), lit from the top down to the current page (its branch, when
 * one's open). Re-measured as the list changes size (a section's pages arriving) and once web fonts load.
 */
function useWire(list: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [wire, setWire] = useState<{ top: number; height: number; lit: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const mid = (n: HTMLElement) => n.offsetTop + n.offsetHeight / 2;
    const place = () => {
      const rows = [...el.querySelectorAll<HTMLElement>("[data-circuit-row]")];
      const nodes = [...el.querySelectorAll<HTMLElement>("[data-circuit-row], [data-circuit-branch]")];
      if (rows.length < 2) return setWire(null);
      const top = mid(rows[0]);
      const height = mid(nodes[nodes.length - 1]) - top;
      const branch = el.querySelector<HTMLElement>('[data-circuit-branch][aria-current="page"]');
      const row = el.querySelector<HTMLElement>('[data-circuit-row][aria-current="page"]');
      // A page on a branch is reached through its elbow, which leaves the wire at the top of its row: the wire stops
      // there, or it would carry on straight past the curve.
      const to = branch ? branch.offsetTop - top : row ? mid(row) - top : 0;
      setWire({ top, height, lit: Math.max(0, to) });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says what moves the current page
  }, deps);
  return wire;
}
