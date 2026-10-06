import { BatteryShortcuts } from "~/features/battery/components/BatteryShortcuts";
import { useBatteryMode } from "~/features/battery/hooks";
import { describeMode } from "~/features/battery/utils";
import { cn } from "~/features/common/ui/utils";

/**
 * What the battery is set to do, as a pill in its card's header: "Normal · keeps 5% in reserve", "Standby · until 14:05",
 * "iSolarCloud · force charging at 6.6 kW"; with the shortcuts beside it. Nothing when the battery can't be
 * controlled from here.
 */
export function BatteryModeLine({
  now,
  shortcuts = true,
  className,
}: {
  now: number;
  shortcuts?: boolean;
  className?: string;
}) {
  const mode = useBatteryMode();
  if (!mode) return null;
  const { label, detail, special } = describeMode(mode, now);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border py-1.5 pr-1.5 pl-3.5 transition-colors duration-500",
        special ? "border-battery/25 bg-battery/10" : "border-line-subtle bg-canvas/60 light:bg-canvas",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm leading-5">
        <span
          aria-hidden
          className={cn("size-2 flex-none rounded-full", special ? "animate-pulse-soft bg-battery" : "bg-ink-faint")}
        />
        {/* one line: the detail gives way first, and the whole of it is in the title */}
        <span className="min-w-0 truncate" title={detail ? `${label} · ${detail}` : label}>
          <span className="font-semibold">{label}</span>
          {/* phones show the mode alone; its detail is in the title */}
          {detail && <span className="text-ink-muted max-sm:hidden"> · {detail}</span>}
        </span>
      </span>
      {shortcuts && <BatteryShortcuts />}
    </div>
  );
}
