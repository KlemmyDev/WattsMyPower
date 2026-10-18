import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { TitleBlock } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";

/*
 * A card that answers as you point (docs/design-language.md): picking a bar or day reads it out in the card's own
 * header, in place of a tooltip.
 */

/**
 * Which item of a chart is picked. Pointing at one (or focusing it) reads it out while the pointer is on it. Clicking
 * or tapping one pins it, so it stays read out after the pointer moves away; clicking it again, or anywhere outside the
 * chart, puts the card back. Spread `plot` on the chart and `item(k)` on each item's button. A finger lifting doesn't
 * count as leaving, so a tapped bar stays read out until another is tapped or the page is tapped elsewhere.
 */
export function usePick<K = number>() {
  const [hover, setHover] = useState<K | null>(null);
  const [pinned, setPinned] = useState<K | null>(null);
  const chart = useRef<HTMLElement | null>(null);
  const picked = pinned ?? hover;
  useEffect(() => {
    if (pinned == null) return;
    const outside = (e: globalThis.PointerEvent) => {
      if (chart.current && !chart.current.contains(e.target as Node)) setPinned(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [pinned]);
  const leave = (e: PointerEvent) => {
    if (e.pointerType !== "touch") setHover(null);
  };
  return {
    picked,
    plot: {
      ref: (el: HTMLElement | null) => {
        chart.current = el;
      },
      onPointerLeave: leave,
    },
    item: (k: K) => ({
      onPointerEnter: () => setHover(k),
      onFocus: () => setHover(k),
      onClick: () => {
        if (pinned === k) {
          setPinned(null);
          setHover(null);
        } else setPinned(k);
      },
      onBlur: () => setHover(null),
    }),
  };
}

/** The class for an item of a picked chart: the others step back while one is read out. */
export const dim = (picked: unknown, me: unknown) =>
  cn("transition-opacity duration-200 motion-reduce:transition-none", picked != null && picked !== me && "opacity-35");

/**
 * A card's header that reads out what's picked: the title, a muted line under it (announced as it changes), and a
 * figure in the corner with what it is above it and, beside it, an optional change chip. It keeps the same height
 * whatever it reads out (room for two lines under the title, and for the chip), so the chart under it never moves:
 * a chart that moved from under the pointer would lose it, put the header back, and flicker.
 */
export function PickHead({
  id,
  title,
  sub,
  label,
  value,
  chip,
}: {
  id: string;
  title: ReactNode;
  sub: ReactNode;
  label?: ReactNode;
  value?: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <TitleBlock
        className="min-w-0 flex-1"
        id={id}
        title={title}
        sub={
          <span aria-live="polite" className="block min-h-10 tabular-nums">
            {sub}
          </span>
        }
      />
      {value != null && (
        <div className="flex min-h-[52px] shrink-0 flex-col items-end gap-0.5 max-sm:min-h-[76px]">
          <span className="text-xs whitespace-nowrap text-ink-faint">{label}</span>
          <span className="flex items-center gap-2 max-sm:flex-col max-sm:items-end max-sm:gap-1">
            {chip && <span className="max-sm:order-1">{chip}</span>}
            <span className="text-[28px] leading-8 font-light tracking-[-1px] whitespace-nowrap tabular-nums">
              {value}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/** A key entry under a chart: a small swatch (any shape, from `swatch`) and its words. */
export function KeyItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}

/** A row of key entries under a chart. */
export function ChartKey({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted", className)}>
      {children}
    </div>
  );
}
