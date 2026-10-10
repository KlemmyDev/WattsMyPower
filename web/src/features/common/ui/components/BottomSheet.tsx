import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/features/common/ui/components/Button";
import { cn } from "~/features/common/ui/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** How far down a drag must go to close the sheet, in px. */
const CLOSE_DRAG = 80;

/**
 * A sheet rising from the bottom of a phone's screen with a few options, over no more than the lower half: what's
 * above it (the picture they change) stays in view, and isn't dimmed. Done, Escape, tapping above it or dragging it
 * down by its top closes it, and focus goes back to what opened it. While it's open Tab stays inside it and the page
 * behind doesn't scroll. It's drawn over the whole app (the phone's dock too), wherever it's used.
 */
export function BottomSheet({
  open,
  title,
  sub,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    sheet.current?.focus({ preventScroll: true });
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    // The page stays put by holding back scrolling anywhere but the sheet's choices, rather than by hiding the page's
    // overflow: that would stop the page gliding to show what's being changed as the sheet opens.
    const el = root.current;
    const hold = (e: Event) => {
      const b = body.current;
      if (!b || !b.contains(e.target as Node) || b.scrollHeight <= b.clientHeight) e.preventDefault();
    };
    el?.addEventListener("wheel", hold, { passive: false });
    el?.addEventListener("touchmove", hold, { passive: false });
    return () => {
      window.removeEventListener("keydown", key);
      el?.removeEventListener("wheel", hold);
      el?.removeEventListener("touchmove", hold);
      opener?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  // Tab and Shift+Tab go round the sheet's controls rather than out to the page.
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !sheet.current) return;
    const all = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === sheet.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Dragging the top of the sheet down moves it with the finger; far enough and it closes, else it springs back.
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: e.clientY, dy: 0 });
  };
  const move = (e: PointerEvent) => drag && setDrag({ ...drag, dy: Math.max(0, e.clientY - drag.from) });
  const up = () => {
    if (drag && drag.dy > CLOSE_DRAG) onClose();
    setDrag(null);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={root}
      data-open={open}
      inert={!open}
      className="group fixed inset-0 z-50 data-[open=false]:pointer-events-none"
    >
      {/* Tapping anywhere above the sheet closes it; it's see-through so the picture shows as it is. */}
      <div aria-hidden onClick={onClose} className="absolute inset-0" />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onKeyDown={trap}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[min(56dvh,560px)] translate-y-full flex-col rounded-t-[24px] border-t border-line-subtle bg-surface shadow-pop outline-none group-data-[open=true]:translate-y-0",
          !drag && "transition-transform duration-[380ms] ease-out-soft",
        )}
        style={drag?.dy ? { translate: `0 ${drag.dy}px` } : undefined}
      >
        <div
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="flex flex-none touch-none flex-col gap-2 px-4 pt-2 pb-3 select-none"
        >
          <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-fg/20" />
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
              <h2 id={id} className="text-lg">
                {title}
              </h2>
              {sub && <div className="text-[13px] leading-5 text-pretty text-ink-muted">{sub}</div>}
            </div>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
        <div
          ref={body}
          className="flex min-h-0 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
