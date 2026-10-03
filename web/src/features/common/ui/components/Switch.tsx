import type { ButtonHTMLAttributes } from "react";
import { cn } from "~/features/common/ui/utils";

/** An on/off switch. Give it a `label` (read out by screen readers) unless it's labelled another way. */
export function Switch({
  on,
  onChange,
  label,
  className,
  ...rest
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-7 w-12 flex-none items-center rounded-full border-0 p-0.5 transition-colors duration-200 disabled:opacity-50",
        on ? "bg-good" : "bg-track",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block size-6 rounded-full bg-ink shadow-[0_1px_3px_var(--color-shadow-pill)] transition-transform duration-200 light:bg-surface",
          on ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
