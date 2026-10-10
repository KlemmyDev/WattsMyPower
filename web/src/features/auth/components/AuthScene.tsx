import { useState } from "react";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { HouseScene, type HouseFlows } from "~/features/overview/components/HouseScene";
import type { HouseOptions } from "~/features/overview/utils/house/layout";

/** A sunny afternoon: the panels running the house, filling the battery and sending the rest to the grid. */
const DAY: HouseFlows = { pv: 5.2, grid: -1.4, bat: 1.8, soc: 0.68, tesla: 0, conn: false };
/** The evening: the battery running the house. */
const NIGHT: HouseFlows = { pv: 0, grid: 0, bat: -0.9, soc: 0.54, tesla: 0, conn: false };

const isDay = () => {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
};

/**
 * The Overview's house, power running along its lines, for the sign-in page: by day the sun on the panels, after dark
 * the battery carrying the house. The sun and moon in its corner switch between the two, the skies crossfading. `house`
 * draws it as chosen (the set-up guide's house step), else the default house.
 */
export function AuthScene({ className, house }: { className?: string; house?: HouseOptions }) {
  const [day, setDay] = useState(isDay);
  return (
    <div
      className={cn(
        "relative aspect-[2/1] w-full overflow-hidden rounded-[28px] max-md:rounded-[22px] light:outline light:outline-line-subtle",
        className,
      )}
    >
      {/* Both skies drawn, one over the other, so switching fades between them. */}
      <div aria-hidden className="absolute inset-0">
        <HouseScene flows={NIGHT} sky="night" house={house} />
      </div>
      <div
        aria-hidden
        className="absolute inset-0 transition-opacity duration-700 ease-out"
        style={{ opacity: day ? 1 : 0 }}
      >
        <HouseScene flows={DAY} sky="sunny" house={house} />
      </div>
      <div
        role="group"
        aria-label="Time of day in the picture"
        className="absolute top-3 right-3 flex gap-0.5 rounded-full border border-line-subtle bg-canvas/92 p-1 shadow-[0_14px_36px_-14px_rgb(0_0_0/0.55)] backdrop-blur-xl light:bg-surface/90"
      >
        {(
          [
            ["sun", true, "Day"],
            ["moon", false, "Night"],
          ] as const
        ).map(([icon, value, label]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={day === value}
            onClick={() => setDay(value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors duration-200",
              day === value ? "bg-ink text-ink-inverse" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon name={icon} size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}
