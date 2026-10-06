import { BatteryShortcuts } from "~/features/battery/components/BatteryShortcuts";
import { useBatteryMode } from "~/features/battery/hooks";
import { describeMode } from "~/features/battery/utils";
import { cn } from "~/features/common/ui/utils";

/**
 * What the battery is set to do, as a line in its card: "Normal · keeps 5% in reserve", "Standby · until 14:05",
 * "iSolarCloud · force charging at 6.6 kW"; with the shortcuts beside it. Nothing when the battery can't be
 * controlled from here.
 */
export function BatteryModeLine({ now, shortcuts = true }: { now: number; shortcuts?: boolean }) {
  const mode = useBatteryMode();
  if (!mode) return null;
  const { label, detail, special } = describeMode(mode, now);
  return (
    <div
      className={cn(
        "relative z-1 mt-1 flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5",
        special ? "bg-battery/12" : "bg-canvas/70 light:bg-canvas",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5 text-sm">
        <span aria-hidden className={cn("size-2 flex-none rounded-full", special ? "bg-battery" : "bg-ink-faint")} />
        <span className="min-w-0">
          <span className="font-semibold">{label}</span>
          {detail && <span className="text-ink-muted"> · {detail}</span>}
        </span>
      </span>
      {shortcuts && <BatteryShortcuts />}
    </div>
  );
}
