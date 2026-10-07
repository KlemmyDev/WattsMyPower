import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh, pct } from "~/features/common/formatting/utils/number";
import {
  NAV_DOCKED,
  useLiveStatus,
  useMedia,
  useNavCollapsed,
  useNavItems,
  useSectionPages,
} from "~/features/common/layout/hooks";
import { NAV_GROUPS, SETTINGS_COLOR, sectionOf, type NavPage, type SectionPages } from "~/features/common/layout/utils";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { BrandMark, Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

// A section's pages say for themselves which is current (a room is, on its devices' pages). Their links only count
// themselves current on their exact page, so a link up the path ("/home") doesn't light up as well.
const EXACT = { exact: true, includeSearch: false } as const;

/**
 * The navigation from tablets up, docked down the left. From xl it's the circuit: sections in groups with a reading
 * each, on a wire lit from the top down to the page you're on, and the current section's pages branching off its node.
 * Collapsed (or below xl) it's a rail of the same circuit with icons only, and a section's pages get a column beside
 * it (from xl; narrower screens list them over the page). Below xl, the rail's button opens the full circuit as a menu.
 */
export function SideNav({ onMenu }: { onMenu: () => void }) {
  const docked = useMedia(NAV_DOCKED);
  const [collapsed, setCollapsed] = useNavCollapsed();
  const full = docked && !collapsed;
  const current = useRouterState({ select: (s) => sectionOf(s.location.pathname) });
  const pages = useSectionPages(current);
  return (
    <>
      <nav
        aria-label="Main"
        data-full={full}
        className="fixed inset-y-0 left-0 z-30 w-[72px] border-r border-line-subtle bg-canvas transition-[width] duration-[450ms] ease-out-soft data-[full=true]:w-[236px] data-[full=true]:overflow-hidden max-md:hidden"
      >
        {full ? (
          <div className="h-full w-[236px]">
            <Circuit
              variant="full"
              branches
              toggle={{ icon: "panelClose", label: "Collapse", onClick: () => setCollapsed(true) }}
            />
          </div>
        ) : (
          <Circuit
            variant="rail"
            toggle={
              docked
                ? { icon: "panelOpen", label: "Expand", onClick: () => setCollapsed(false) }
                : { icon: "menu", label: "Menu", onClick: onMenu }
            }
          />
        )}
      </nav>
      {docked && collapsed && pages && <NavColumn key={current} pages={pages} />}
    </>
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
        className="absolute inset-y-0 left-0 w-[min(288px,86vw)] -translate-x-full border-r border-line-subtle bg-canvas shadow-pop transition-transform duration-[380ms] ease-out-soft group-data-[open=true]:translate-x-0"
      >
        <Circuit variant="full" toggle={{ icon: "x", label: "Close menu", onClick: onClose }} />
      </div>
    </div>
  );
}

type Toggle = { icon: IconName; label: string; onClick: () => void };

/**
 * The circuit itself: in full (labels and readings) or as a rail of icons. Docked open, the current section's pages
 * branch off it (`branches`); in the menu they don't, as the page lists them in its row of pills.
 */
function Circuit({
  variant,
  toggle,
  branches = false,
}: {
  variant: "full" | "rail";
  toggle: Toggle;
  branches?: boolean;
}) {
  const full = variant === "full";
  const items = useNavItems();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = sectionOf(path);
  const pages = useSectionPages(current);
  const p = useSnapshot();
  const list = useRef<HTMLDivElement>(null);
  const wire = useWire(list, [path, items.length, variant, pages?.pages.length]);
  const at = items.findIndex((i) => i.to === current);
  const value: Partial<Record<string, string>> = p
    ? { "/": kW(p.pv_power), "/home": kW(p.load_power), "/battery": pct(p.battery_soc), "/history": kWh(p.daily_pv) }
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
              <span className="circuit-lit" style={{ top: wire.litTop, height: wire.lit }} />
            </span>
          )}
          {NAV_GROUPS.map((g, gi) => (
            <Fragment key={g}>
              <div
                className={cn(
                  "text-xs font-medium text-ink-faint",
                  full ? "pb-1.5 pl-[38px]" : "h-2",
                  full && (gi ? "pt-4" : "pt-0.5"),
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
          <div className="mt-auto flex flex-col pt-5">
            <CircuitLink
              to="/settings"
              icon="settings"
              label="Settings"
              color={SETTINGS_COLOR}
              full={full}
              on={current === "/settings"}
            />
            {branches && current === "/settings" && pages && <Branch pages={pages} />}
          </div>
        </div>
      </div>
      <LiveChip full={full} />
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
        full ? "pr-2.5 pl-[38px]" : "pl-[26px]",
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

/** Whether readings are coming in, with the time: a chip in full, a dot over the time on the rail. */
function LiveChip({ full }: { full: boolean }) {
  const { state, status, now } = useLiveStatus();
  const word = state === "live" ? "Inverter live" : state === "stale" ? "Readings delayed" : "Inverter offline";
  return full ? (
    <div
      title={`${status}.`}
      className="flex h-10 flex-none items-center gap-2.5 rounded-xl border border-fg/6 bg-fg/4 px-3 text-[12.5px] text-ink-soft tabular-nums"
    >
      <span className="live-dot" data-state={state} />
      <span>{word}</span>
      <span className="ml-auto text-ink-faint">{hhmm(now)}</span>
    </div>
  ) : (
    <span
      title={`${status}.`}
      className="flex flex-col items-center gap-2 pt-1 font-mono text-[11px] text-ink-dim tabular-nums"
    >
      <span className="live-dot" data-state={state} />
      {hhmm(now)}
    </span>
  );
}

/**
 * A section's pages in a column beside the collapsed rail (from xl): its name, a line on what's in it, and each page
 * with its reading and a bar for its share.
 */
function NavColumn({ pages }: { pages: SectionPages }) {
  return (
    <aside
      aria-label={`${pages.title} pages`}
      className="fixed inset-y-0 left-[72px] z-20 w-[248px] [scrollbar-width:thin] overflow-y-auto overscroll-contain border-r border-line-subtle bg-surface max-xl:hidden"
    >
      <div className="nav-column-in flex flex-col px-3 pt-6 pb-6">
        <div className="flex flex-col gap-1 px-2 pb-3">
          {pages.root ? (
            <Link
              {...pages.root.link}
              className="font-display text-[21px] font-bold tracking-[-0.4px] text-ink no-underline hover:text-ink-hover"
            >
              {pages.title}
            </Link>
          ) : (
            <span className="font-display text-[21px] font-bold tracking-[-0.4px] text-ink">{pages.title}</span>
          )}
          {pages.sub && <div className="text-[13px] leading-snug text-pretty text-ink-muted">{pages.sub}</div>}
        </div>
        {pages.pages.map((page, i) => (
          <Fragment key={page.key}>
            {page.group && page.group !== pages.pages[i - 1]?.group && (
              <ColumnLabel aside={page.groupValue}>{page.group}</ColumnLabel>
            )}
            <Link
              {...page.link}
              activeOptions={EXACT}
              aria-current={page.active ? "page" : undefined}
              className="grid min-h-[38px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[11px] px-2.5 py-1.5 text-[13.5px] text-ink-soft no-underline transition-colors duration-150 hover:bg-fg/4 hover:text-ink aria-[current=page]:bg-fg/7 aria-[current=page]:text-ink"
            >
              <ColumnRow page={page} />
            </Link>
          </Fragment>
        ))}
      </div>
    </aside>
  );
}

function ColumnLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2.5 pt-3 pb-1.5 text-xs font-medium text-ink-faint">
      <span className="min-w-0 truncate">{children}</span>
      {aside && <span className="tabular-nums">{aside}</span>}
    </div>
  );
}

function ColumnRow({ page }: { page: NavPage }) {
  return (
    <>
      {page.icon ? (
        <Icon name={page.icon} size={16} />
      ) : (
        <span className="size-2 rounded-full" style={{ background: page.color ?? alpha(COLOR.fg, 0.22) }} />
      )}
      <span className="truncate">{page.label}</span>
      <span className="text-[12.5px] text-ink-faint tabular-nums">{page.value}</span>
      {page.share != null && (
        <span className="col-span-full mt-1.5 h-0.5 overflow-hidden rounded-full bg-fg/7">
          <span
            className="block h-full rounded-full transition-[width] duration-700 ease-out-soft"
            style={{
              width: `${Math.max(0, Math.min(1, page.share)) * 100}%`,
              background: page.color ?? COLOR.solar,
            }}
          />
        </span>
      )}
    </>
  );
}

/**
 * Where the wire runs, in pixels down the list: from the first section's node to the last node on it (Settings', or
 * the last of its pages when they're open), lit from the top down to the current page (its branch, when one's open).
 * Settings sits at the bottom, so it's lit from its own node down to its page instead. Re-measured as the list changes
 * size (a section's pages arriving) and once web fonts load.
 */
function useWire(list: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [wire, setWire] = useState<{ top: number; height: number; litTop: number; lit: number } | null>(null);
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
      const from = row && row === rows[rows.length - 1] ? mid(row) - top : 0;
      // A page on a branch is reached through its elbow, which leaves the wire at the top of its row: the wire stops
      // there, or it would carry on straight past the curve.
      const to = branch ? branch.offsetTop - top : row ? mid(row) - top : from;
      setWire({ top, height, litTop: from, lit: Math.max(0, to - from) });
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
