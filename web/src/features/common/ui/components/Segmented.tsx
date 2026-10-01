import type { ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

type Option<T extends string> = { value: T; label: ReactNode };

/**
 * A row of mutually exclusive buttons in a pill-shaped track. `role="tablist"` renders tabs
 * (aria-selected); otherwise toggle buttons (aria-pressed).
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
  return (
    <div
      role={role}
      aria-label={label}
      className={cn("flex gap-1 rounded-full border border-chip-line bg-canvas p-1", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={role === "tablist" ? "tab" : undefined}
            aria-selected={role === "tablist" ? on : undefined}
            aria-pressed={role === "tablist" ? undefined : on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-none items-center gap-2 rounded-full border-0 px-4 py-[9px] text-sm font-semibold whitespace-nowrap transition-colors duration-200",
              on ? "bg-ink text-ink-inverse" : "bg-transparent text-ink-muted hover:text-ink",
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
