import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "~/features/common/api/utils";
import { useMedia } from "~/features/common/layout/hooks";
import { alpha } from "~/features/common/theme/utils/colors";
import { BottomSheet } from "~/features/common/ui/components/BottomSheet";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { ICON_CHOICES, PALETTE, paletteColor, type PaletteKey } from "~/features/home/utils";

/** A look as chosen: a palette key and an icon name, each null for the one it's given. */
export type Look = { color: string | null; icon: string | null };
/** A change to a look: what's set (null: back to the one it's given). */
export type LookChange = { color?: PaletteKey | null; icon?: string | null };

/** An icon's name in words: "Cooking pot" for cookingPot. */
const iconWords = (name: string) => {
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const WORDS: Record<PaletteKey, string> = {
  jade: "Jade",
  violet: "Violet",
  rose: "Rose",
  green: "Green",
  coral: "Coral",
  sky: "Sky",
  magenta: "Magenta",
  brown: "Brown",
  cyan: "Cyan",
  olive: "Olive",
};

/**
 * A room's or device's icon, in its colour, as a button that opens the picker for both. Lit (filled in its colour) while
 * it's drawing power or running, faint while it's offline. Its look is saved as each choice is made.
 */
export function LookButton({
  name,
  icon,
  color,
  lit,
  off,
  look,
  given,
  onPick,
  pending,
  error,
  size = 48,
}: {
  /** What it's called, for the button and the picker's title. */
  name: string;
  /** Its icon and colour as shown. */
  icon: IconName;
  color: string;
  lit: boolean;
  off: boolean;
  /** What's chosen for it, and what it's given without a choice. */
  look: Look;
  given: { color: string; icon: IconName };
  onPick: (change: LookChange) => void;
  pending: boolean;
  error: unknown;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  // On a phone the sheet stays in the page to slide in and out, so its choices are only drawn once it's been opened.
  const [opened, setOpened] = useState(false);
  if (open && !opened) setOpened(true);
  const anchor = useRef<HTMLButtonElement>(null);
  const phone = useMedia("(max-width: 639px)");
  const picker = (
    <Picker
      color={color}
      icon={icon}
      look={look}
      given={given}
      onPick={onPick}
      pending={pending}
      error={error}
      // The sheet has its own.
      onDone={phone ? undefined : () => setOpen(false)}
    />
  );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`Change ${name}'s icon and colour`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          // On a phone, the card glides up clear of the sheet, so what's changed stays in view.
          if (!open && phone && anchor.current)
            window.scrollBy({ top: anchor.current.getBoundingClientRect().top - 96, behavior: "smooth" });
          setOpen((o) => !o);
        }}
        className="group/look relative flex flex-none cursor-pointer items-center justify-center rounded-[15px] border-0 p-0 transition-[background,color,box-shadow] duration-500 ease-out-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        style={{
          width: size,
          height: size,
          background: off ? alpha(color, 0.06) : lit ? color : alpha(color, 0.15),
          color: off ? "var(--color-ink-faint)" : lit ? "#fff" : color,
          boxShadow: lit ? `0 6px 18px -6px ${alpha(color, 0.7)}` : "none",
        }}
      >
        <Icon name={icon} size={Math.round(size * 0.46)} />
        {/* Pointed at (or focused), a pencil in the corner says it can be changed. */}
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-line bg-surface-raised text-ink opacity-0 shadow-sm transition-opacity duration-150 group-hover/look:opacity-100 group-focus-visible/look:opacity-100"
        >
          <Icon name="pencil" size={11} />
        </span>
      </button>
      {phone ? (
        <BottomSheet open={open} title={name} sub="Its icon and colour" onClose={() => setOpen(false)}>
          {opened && picker}
        </BottomSheet>
      ) : (
        open && (
          <Popover anchor={anchor} label={`${name}'s icon and colour`} onClose={() => setOpen(false)}>
            <div className="flex flex-col gap-1 pb-1">
              <span className="text-sm font-semibold text-ink">{name}</span>
            </div>
            {picker}
          </Popover>
        )
      )}
    </>
  );
}

/**
 * A panel under what opened it (flipped above, or nudged in, where there's no room), over the page: Escape, or
 * pointing outside it, closes it, and focus goes back to what opened it.
 */
function Popover({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current;
      if (!a || !p) return;
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const left = Math.max(12, Math.min(a.left, window.innerWidth - w - 12));
      const below = a.bottom + 10;
      const top = below + h > window.innerHeight - 12 && a.top - h - 10 > 12 ? a.top - h - 10 : below;
      setAt({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Kept current without opening it afresh each render (it's a new function each time).
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const opener = anchor.current;
    panel.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !opener?.contains(t)) close.current();
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
      opener?.focus({ preventScroll: true });
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className="fixed z-50 flex w-[328px] animate-pop flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[0_18px_48px_-12px_rgb(0_0_0/0.55)]"
      style={at ? { left: at.left, top: at.top } : { left: -9999, top: 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** The colours (the one it's given first) and the icons, each saved as it's picked; and going back to both given. */
function Picker({
  color,
  icon,
  look,
  given,
  onPick,
  pending,
  error,
  onDone,
}: {
  color: string;
  icon: IconName;
  look: Look;
  given: { color: string; icon: IconName };
  onPick: (change: LookChange) => void;
  pending: boolean;
  error: unknown;
  /** Closes it, where it has its own Done. */
  onDone?: () => void;
}) {
  const ring = "outline-2 outline-offset-2 outline-ink";
  const own = look.color != null || look.icon != null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-ink-muted">Colour</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={look.color == null}
            aria-label="Its usual colour"
            title="Its usual colour"
            onClick={() => onPick({ color: null })}
            className={cn(
              "relative size-7 cursor-pointer rounded-full border-0 p-0 transition-transform hover:scale-110",
              look.color == null && ring,
            )}
            style={{ background: given.color }}
          >
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
              A
            </span>
          </button>
          {PALETTE.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={look.color === key}
              aria-label={WORDS[key]}
              title={WORDS[key]}
              onClick={() => onPick({ color: key })}
              className={cn(
                "size-7 cursor-pointer rounded-full border-0 p-0 transition-transform hover:scale-110",
                look.color === key && ring,
              )}
              style={{ background: paletteColor(key) }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-ink-muted">Icon</span>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
          {ICON_CHOICES.map((name) => {
            const on = name === icon;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                aria-label={name === given.icon ? `${iconWords(name)} (its usual icon)` : iconWords(name)}
                title={iconWords(name)}
                // Its usual one is saved as no choice, so it follows a change of name or kind.
                onClick={() => onPick({ icon: name === given.icon ? null : name })}
                className={cn(
                  "relative flex aspect-square cursor-pointer items-center justify-center rounded-xl border-0 p-0 transition-colors",
                  on ? "" : "bg-transparent text-ink-muted hover:bg-fg/6 hover:text-ink",
                )}
                style={on ? { background: alpha(color, 0.18), color } : undefined}
              >
                <Icon name={name} size={20} />
                {name === given.icon && (
                  <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-ink-faint" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      {error != null && <HelpText tone="bad">{errorMessage(error)}</HelpText>}
      <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-3">
        <button
          type="button"
          disabled={!own || pending}
          onClick={() => onPick({ color: null, icon: null })}
          className="cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] text-brand hover:underline disabled:cursor-default disabled:text-ink-faint disabled:no-underline"
        >
          Back to the usual look
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="cursor-pointer rounded-full border-0 bg-ink px-3.5 py-1.5 font-sans text-[13px] font-semibold text-canvas"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
