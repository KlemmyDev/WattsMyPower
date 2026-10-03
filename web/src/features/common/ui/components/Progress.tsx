import { cn } from "~/features/common/ui/utils";

/** A small turning ring for work under way. Decorative: say what's happening in text beside it. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("flex-none animate-spin text-brand motion-reduce:animate-none", className)}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * How far along something is, as a bar. `value` from 0 to 1; leave it out while that isn't known yet, and the
 * bar shows a band sweeping across instead.
 */
export function ProgressBar({ value, label, className }: { value?: number; label: string; className?: string }) {
  const known = value != null && Number.isFinite(value);
  const pct = known ? Math.round(Math.min(Math.max(value, 0), 1) * 100) : undefined;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-track", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-brand transition-[width] duration-500",
          !known && "w-1/3 animate-[progressSweep_1.2s_ease-in-out_infinite] motion-reduce:animate-none",
        )}
        style={known ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
