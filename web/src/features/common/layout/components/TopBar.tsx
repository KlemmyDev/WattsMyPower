import { Link } from "@tanstack/react-router";
import { AccountAvatar } from "~/features/auth/components/AccountAvatar";
import { Icon } from "~/features/common/ui/components/Icon";
import { useLiveStatus, useScrolled } from "~/features/common/layout/hooks";
import { cn } from "~/features/common/ui/utils";
import { fullDate, hhmm, pillDate, tzName } from "~/features/common/formatting/utils/date";

/**
 * The header on a phone: a menu button that opens the side nav's circuit, the name, the live clock, and the account.
 * It stays at the top while the page scrolls. At the top it's see-through; once content passes under it, it gets a
 * translucent background and a hairline so the two don't clash. From tablets up the clock and account are in the
 * page's top right corner instead (AppShell).
 */
export function TopBar({ onMenu }: { onMenu: () => void }) {
  const scrolled = useScrolled();
  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b pt-4 pb-2 transition-[background-color,border-color] duration-200 md:hidden",
        scrolled ? "border-line-subtle bg-canvas/80 backdrop-blur-xl" : "border-transparent",
      )}
    >
      <header className="flex items-center gap-2.5 px-4">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Menu"
          className="flex size-10 flex-none items-center justify-center rounded-full border border-fg/8 bg-chip text-ink-muted transition-colors duration-200 hover:border-fg/20 hover:text-ink active:scale-95"
        >
          <Icon name="menu" size={18} />
        </button>
        <Link
          to="/"
          aria-label="WattsMyPower, overview"
          className="min-w-0 truncate font-display text-lg font-semibold tracking-[-0.3px] text-ink no-underline hover:text-ink"
        >
          Watts<span className="text-solar">My</span>Power
        </Link>
        <HeaderClock className="ml-auto" />
        <AccountAvatar />
      </header>
    </div>
  );
}

/** Whether readings are coming in, with the date and time: a pill beside the account. */
export function HeaderClock({ className }: { className?: string }) {
  const { state, status, now } = useLiveStatus();
  const d = new Date(now * 1000);
  return (
    <span
      className={cn(
        "flex h-10 flex-none items-center gap-2 rounded-full border border-chip-line bg-chip px-3.5 font-mono text-[13px] whitespace-nowrap text-ink-soft tabular-nums",
        className,
      )}
      title={`${fullDate.format(d)}, ${hhmm(now)} ${tzName}. ${status}.`}
    >
      <span className="live-dot" data-state={state} aria-hidden />
      {/* The dot's colour, in words, for a screen reader (the title isn't read out everywhere). */}
      <span className="sr-only">{status}.</span>
      <span className="text-ink-dim max-xs:hidden">{pillDate.format(d)}</span>
      <span>{hhmm(now)}</span>
    </span>
  );
}
