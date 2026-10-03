import { useRef, type ReactNode } from "react";
import { usePillIndicator } from "~/features/common/layout/hooks";
import { cn } from "~/features/common/ui/utils";

type Option<T extends string> = { value: T; label: ReactNode };

/**
 * A row of mutually exclusive buttons in a pill-shaped track. `role="tablist"` renders tabs
 * (aria-selected); otherwise toggle buttons (aria-pressed). The highlight slides to the chosen one,
 * as in the navigation.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "group",
  className,
  buttonClassName,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  role?: "group" | "tablist";
  className?: string;
  buttonClassName?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const ind = usePillIndicator(track, [value, options.length], "[data-on]");
  return (
    <div
      ref={track}
      role={role}
      aria-label={label}
      className={cn("relative flex gap-1 rounded-full border border-chip-line bg-canvas p-1", className)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-ink transition-[left,width,opacity] duration-[340ms,340ms,200ms] ease-spring"
        style={{ left: ind?.left ?? 4, width: ind?.width ?? 0, opacity: ind ? 1 : 0 }}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={role === "tablist" ? "tab" : undefined}
            aria-selected={role === "tablist" ? on : undefined}
            aria-pressed={role === "tablist" ? undefined : on}
            data-on={on || undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-1 flex flex-none items-center gap-2 rounded-full border-0 bg-transparent px-4 py-[9px] text-sm font-semibold whitespace-nowrap transition-[color,transform] duration-[260ms,160ms] active:scale-95",
              on ? "text-ink-inverse" : "text-ink-muted hover:text-ink",
              buttonClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
