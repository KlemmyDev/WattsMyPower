import type { CSSProperties } from "react";
import type { BatteryState } from "~/features/common/energy/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { cn } from "~/features/common/ui/utils";

/**
 * What the battery's doing, compact: "↑ 2.6 kW" in its blue while it charges, "↓ 1.2 kW" in amber while it discharges
 * (the arrow bobbing the way the power goes), or "Idle". In full in its title and for screen readers.
 */
export function BatteryPower({
  st,
  w,
  className,
}: {
  st: BatteryState | null;
  w: number | null | undefined;
  className?: string;
}) {
  const moving = st === "charge" || st === "discharge";
  const said = st === "charge" ? `Charging at ${kW(w)}` : st === "discharge" ? `Discharging at ${kW(w)}` : "Idle";
  return (
    <span
      title={said}
      className={cn(
        "flex items-center gap-1 text-xs leading-4 font-semibold whitespace-nowrap tabular-nums transition-colors duration-500",
        st === "charge" ? "text-link" : st === "discharge" ? "text-warn" : "text-ink-muted",
        className,
      )}
    >
      <span className="sr-only">{said}</span>
      {st != null && (
        <span aria-hidden className="flex items-center gap-1">
          {moving && (
            <span
              className="inline-block animate-[wmpNudge_1.6s_ease-in-out_infinite] leading-none"
              style={{ "--nudge": st === "discharge" ? "1.5px" : "-1.5px" } as CSSProperties}
            >
              {st === "charge" ? "↑" : "↓"}
            </span>
          )}
          {moving ? kW(w) : "Idle"}
        </span>
      )}
    </span>
  );
}
