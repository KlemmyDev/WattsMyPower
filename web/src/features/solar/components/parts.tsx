import type { ReactNode } from "react";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { cn } from "~/features/common/ui/utils";

export const SOLAR = COLOR.solar;
/** What was expected: a dashed grey line beside solar's. */
export const EXPECTED = alpha(COLOR.fg, 0.45);

/** A figure with its unit set smaller after it: "4.7" "kW". */
export function Figure({ value, unit, size = "md" }: { value: ReactNode; unit?: ReactNode; size?: "md" | "xl" }) {
  return (
    <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
      <span
        className={
          size === "xl"
            ? "text-[64px] leading-16 tracking-[-3px] max-sm:text-[48px] max-sm:leading-12 max-sm:tracking-[-2px]"
            : "text-[28px] leading-8 tracking-[-0.8px]"
        }
      >
        {value}
      </span>
      {unit && <span className={cn("font-normal text-ink-faint", size === "xl" ? "text-xl" : "text-sm")}>{unit}</span>}
    </span>
  );
}

/** A change in a small chip: green up, amber down, grey level. */
export function Delta({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  const up = value > 0.005;
  const down = value < -0.005;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap tabular-nums",
        up ? "bg-good-subtle text-good" : down ? "bg-warn-subtle text-warn" : "bg-fg/6 text-ink-muted",
        className,
      )}
    >
      {(up || down) && (
        <svg aria-hidden viewBox="0 0 10 10" className={cn("size-2.5", down && "rotate-180")}>
          <path d="M5 1.5 L8.5 6.5 H1.5 Z" fill="currentColor" />
        </svg>
      )}
      {children}
    </span>
  );
}

/** A dot that breathes while the panels are making power, and rests while they aren't. */
export function LiveDot({ on, color }: { on: boolean; color: string }) {
  return (
    <span aria-hidden className="relative flex size-2">
      {on && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden"
          style={{ background: color }}
        />
      )}
      <span className="relative size-2 rounded-full" style={{ background: color, opacity: on ? 1 : 0.5 }} />
    </span>
  );
}

/** A slim bar out of a whole, with a tick across it for what it's measured against (what was expected). */
export function Meter({
  share,
  color = SOLAR,
  mark,
  className,
}: {
  share: number;
  color?: string;
  mark?: { at: number; label: string };
  className?: string;
}) {
  const c = (v: number) => Math.max(0, Math.min(1, v)) * 100;
  return (
    <span className={cn("relative block h-1.5 rounded-full bg-track", className)}>
      <span
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft"
        style={{ width: `${c(share)}%`, background: color }}
      />
      {mark && (
        <span
          title={mark.label}
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${c(mark.at)}%` }}
        />
      )}
    </span>
  );
}
