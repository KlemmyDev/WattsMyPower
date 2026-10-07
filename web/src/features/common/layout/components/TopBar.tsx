import { Link, useRouterState } from "@tanstack/react-router";
import { useRef } from "react";
import { BrandMark, Icon } from "~/features/common/ui/components/Icon";
import { useLiveStatus, useNavItems, usePillIndicator, useScrolled } from "~/features/common/layout/hooks";
import { sectionOf } from "~/features/common/layout/utils";
import { cn } from "~/features/common/ui/utils";
import { fullDate, hhmm, pillDate, tzName } from "~/features/common/formatting/utils/date";

/**
 * The header on a phone (from tablets up, the navigation is the side nav). It stays at the top while the page
 * scrolls. At the top it's see-through, as in the design; once content passes under it, it gets a translucent
 * background and a hairline so the two don't clash.
 */
export function TopBar() {
  const scrolled = useScrolled();
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b pt-5 pb-3 transition-[background-color,border-color] duration-200 max-sm:pt-4 max-sm:pb-2 md:hidden",
        scrolled ? "border-line-subtle bg-canvas/80 backdrop-blur-xl" : "border-transparent",
      )}
    >
      <header className="relative mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-8 max-sm:gap-2 max-sm:px-4 max-2xs:gap-1.5">
        <Link
          to="/"
          aria-label="WattsMyPower, overview"
          className="flex flex-none items-center gap-3 text-ink no-underline hover:text-ink"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl border border-fg/8 bg-linear-160 from-mark-from to-mark-to max-sm:size-10 max-sm:rounded-[13px] max-2xs:size-9">
            <BrandMark />
          </span>
          <span className="font-display text-xl font-semibold tracking-[-0.4px] whitespace-nowrap max-xl:hidden">
            Watts<span className="text-solar">My</span>Power
          </span>
        </Link>
        <Nav />
        <div className="flex flex-none items-center gap-2">
          <HeaderClock />
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            activeProps={{ "aria-current": "page", className: "bg-ink! text-ink-inverse!" }}
            className="flex size-12 items-center justify-center rounded-full border border-fg/8 bg-chip text-ink-muted transition-colors duration-200 hover:border-fg/20 hover:text-ink max-sm:size-10 max-2xs:size-9"
          >
            <Icon name="settings" size={18} />
          </Link>
        </div>
      </header>
    </div>
  );
}

function Nav() {
  const items = useNavItems();
  const six = items.length > 5;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = sectionOf(path);
  const navRef = useRef<HTMLElement>(null);
  // The white pill slides under the current page's link.
  const ind = usePillIndicator(navRef, [current, items.length]);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="relative flex min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-full border border-chip-line bg-chip p-1 [&::-webkit-scrollbar]:hidden"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-ink transition-[left,width,opacity] duration-[380ms,380ms,200ms] ease-spring"
        style={{ left: ind?.left ?? 4, width: ind?.width ?? 0, opacity: ind ? 1 : 0 }}
      />
      {items.map((i) => {
        const on = current === i.to;
        return (
          <Link
            key={i.to}
            to={i.to}
            title={i.label}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative z-1 flex h-[38px] flex-none items-center gap-2 rounded-full px-[15px] text-sm font-medium whitespace-nowrap no-underline transition-[color,transform] duration-[260ms,160ms] active:scale-95 max-xl:px-[11px] max-sm:h-8 max-sm:px-[9px] max-2xs:px-[7px]",
              on ? "text-ink-inverse hover:text-ink-inverse" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon name={i.icon} size={16} />
            {/* Labels for every tab need ~1,080 px with five tabs, ~1,170 px with six. */}
            <span className={cn(!on && (six ? "max-3xl:hidden" : "max-2xl:hidden"), "max-sm:hidden")}>{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function HeaderClock() {
  const { state, status, now } = useLiveStatus();
  const d = new Date(now * 1000);
  return (
    <div className="flex h-12 items-center gap-0.5 rounded-full border border-chip-line bg-chip px-2 py-1 max-sm:hidden">
      <span
        className="flex items-center gap-2 px-3 font-mono text-[13px] whitespace-nowrap text-ink-soft tabular-nums"
        title={`${fullDate.format(d)}, ${hhmm(now)} ${tzName}. ${status}.`}
      >
        <span className="live-dot" data-state={state} />
        <span className="text-ink-dim max-md:hidden">{pillDate.format(d)}</span>
        <span>{hhmm(now)}</span>
      </span>
    </div>
  );
}
