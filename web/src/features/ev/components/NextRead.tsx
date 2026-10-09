import { clock, hhmm } from "~/features/common/formatting/utils/date";
import { useNow } from "~/features/common/time/hooks";
import { cn } from "~/features/common/ui/utils";
import type { TeslaStatus } from "~/features/ev/types";

/**
 * When the cars are next read, counting down: "Next check in 2:34", "Checking now…", or after a failed read "Trying
 * again in 0:45". Ticks on its own, so only it re-renders each second.
 */
export function NextRead({ status, className }: { status: TeslaStatus; className?: string }) {
  const now = useNow(1000);
  const next = status.next_read;
  if (next == null) return null;
  const left = next - now;
  const retry = !!status.error;
  // Due: the loop turns every `tick` seconds, so the read starts within that.
  const text = status.reading
    ? "Checking now…"
    : left <= 0
      ? retry
        ? "Trying again any moment"
        : "Checking any moment"
      : `${retry ? "Trying again" : "Next check"} in ${clock(left)}`;
  return (
    <span
      className={cn("text-sm font-normal text-ink-muted tabular-nums", retry && "text-warn", className)}
      role="timer"
      aria-live="off"
      title={left > 0 ? `At ${hhmm(next)}` : undefined}
    >
      {text}
    </span>
  );
}
