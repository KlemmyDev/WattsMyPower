import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useBatteryChange, useBatteryMode } from "~/features/battery/hooks";
import type { ControlRequest } from "~/features/battery/types";
import { isFull, nextAt, when } from "~/features/battery/utils";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { errorMessage } from "~/features/common/api/utils";
import { useNow } from "~/features/common/time/hooks";
import { Icon } from "~/features/common/ui/components/Icon";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";

type Shortcut = { label: string; hint: string; body: ControlRequest; said: string; off?: boolean };

const MORNING = "06:00";
const MENU_W = 272; // px

/** The one-tap controls: standby for a while, a floor until morning, or a charge to full. */
function shortcuts(now: number, full: boolean): Shortcut[] {
  const morning = nextAt(MORNING, now) ?? now + 12 * 3600;
  const by = when(morning, now);
  return [
    {
      label: "Standby for 1 hour",
      hint: "Run the house on solar and the grid",
      body: { kind: "standby", until: now + 3600 },
      said: `Battery on standby until ${when(now + 3600, now)}.`,
    },
    {
      label: "Standby for 3 hours",
      hint: "Run the house on solar and the grid",
      body: { kind: "standby", until: now + 3 * 3600 },
      said: `Battery on standby until ${when(now + 3 * 3600, now)}.`,
    },
    {
      label: `Keep 30% until ${by}`,
      hint: "Then the grid takes over",
      body: { kind: "floor", floor: 30, until: morning },
      said: `The battery keeps 30% until ${by}.`,
    },
    {
      label: `Keep 50% until ${by}`,
      hint: "Then the grid takes over",
      body: { kind: "floor", floor: 50, until: morning },
      said: `The battery keeps 50% until ${by}.`,
    },
    {
      label: "Charge to full",
      hint: full ? "It's already full" : "From the grid when solar can't cover it",
      off: full,
      body: { kind: "charge", until: null },
      said: "Charging the battery to full.",
    },
  ];
}

/** Where the menu goes: under the button, or over it when there's more room above; its right edge on the button's. */
type Place = { right: number; top?: number; bottom?: number };

function placeBy(box: DOMRect): Place {
  const below = window.innerHeight - box.bottom;
  const right = Math.max(8, window.innerWidth - box.right);
  return below < 360 && box.top > below
    ? { right, bottom: window.innerHeight - box.top + 6 }
    : { right, top: box.bottom + 6 };
}

/**
 * A menu of one-tap battery controls (and "Back to normal" while one's in effect), for the Overview's battery card.
 * While another controller has the battery there's nothing to choose: it leads to the Battery page instead.
 *
 * The menu is drawn over the page (a portal), so the card's rounded, clipped corners don't cut it off.
 */
export function BatteryShortcuts() {
  const id = useId();
  const mode = useBatteryMode();
  const soc = useSnapshot()?.battery_soc;
  const now = useNow(30_000);
  const { start, stop } = useBatteryChange();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    if (button.current) setPlace(placeBy(button.current.getBoundingClientRect()));
  }, []);
  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // While it's open: keep it by the button as the page scrolls, close it on a click elsewhere, and start on its first
  // item so the arrow keys work straight away.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", away);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", away);
    };
  }, [open, measure, close]);

  if (!mode) return null;
  const pending = start.isPending || stop.isPending;
  const free = mode.owner === "normal" || mode.owner === "dashboard";
  if (!free)
    return (
      <Link to="/battery" className="flex-none pr-1.5 text-[13px] font-semibold text-link">
        Details
      </Link>
    );
  const active = !!mode.kind && !mode.ending;

  const run = (s: Shortcut) => {
    close(true);
    start.mutate(s.body, { onSuccess: () => toast(s.said), onError: (e) => toast(errorMessage(e)) });
  };
  const normal = () => {
    close(true);
    stop.mutate(undefined, {
      onSuccess: () => toast("The battery is back to normal."),
      onError: (e) => toast(errorMessage(e)),
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close();
    }
  };

  const item =
    "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm outline-0 hover:bg-surface-raised focus-visible:bg-surface-raised";
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={pending}
        onClick={() => {
          measure();
          setOpen((o) => !o);
        }}
        className="flex flex-none items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-60"
      >
        {pending ? "Sending…" : "Shortcuts"}
        <Icon name="chevD" size={14} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-label="Battery shortcuts"
            onKeyDown={onKeyDown}
            style={{ right: place.right, top: place.top, bottom: place.bottom, width: MENU_W }}
            className="fixed z-50 flex max-w-[calc(100vw-16px)] animate-pop flex-col rounded-xl border border-line bg-popover p-1 shadow-pop"
          >
            {active && (
              <>
                <button type="button" role="menuitem" tabIndex={-1} onClick={normal} className={item}>
                  <span className="font-semibold">Back to normal</span>
                  <span className="text-xs text-ink-muted">End what's set now</span>
                </button>
                <div role="separator" className="mx-2 my-1 h-px bg-line-subtle" />
              </>
            )}
            {shortcuts(now, isFull(soc, mode.max_soc)).map((s) => (
              <button
                key={s.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={s.off}
                aria-disabled={s.off}
                onClick={() => run(s)}
                className={cn(item, "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent")}
              >
                <span className="font-medium">{s.label}</span>
                <span className="text-xs text-ink-muted">{s.hint}</span>
              </button>
            ))}
            <div role="separator" className="mx-2 my-1 h-px bg-line-subtle" />
            <Link
              to="/battery"
              role="menuitem"
              tabIndex={-1}
              onClick={() => close()}
              className={cn(item, "flex-row items-center justify-between text-ink no-underline")}
            >
              <span className="font-medium">All battery controls</span>
              <Icon name="chevR" size={14} className="text-ink-faint" />
            </Link>
          </div>,
          document.body,
        )}
    </>
  );
}
