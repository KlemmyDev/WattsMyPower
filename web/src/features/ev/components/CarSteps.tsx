import { Fragment } from "react";
import { alpha } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { CarStep } from "~/features/ev/utils";

const STEPS: { step: CarStep; label: string; icon: IconName }[] = [
  { step: "asleep", label: "Asleep", icon: "moon" },
  { step: "awake", label: "Awake", icon: "car" },
  { step: "charging", label: "Charging", icon: "bolt" },
];

/**
 * Where the car is between asleep, awake and charging, as three steps with the one it's at lit in `color` (and its
 * icon breathing while it charges), so which it is shows at a glance. `detail` goes beside the lit step's name
 * ("Charging · 7.4 kW").
 */
export function CarSteps({ step, color, detail }: { step: CarStep; color: string; detail?: string | null }) {
  const at = STEPS.findIndex((s) => s.step === step);
  return (
    <div
      className="flex min-w-0 items-center gap-1 rounded-full border border-line-subtle bg-fg/4 p-1"
      role="img"
      aria-label={`${STEPS[at].label}${detail ? `, ${detail}` : ""}`}
    >
      {STEPS.map((s, i) => {
        const on = i === at;
        return (
          <Fragment key={s.step}>
            {i > 0 && (
              <span
                aria-hidden
                className="h-px w-2.5 flex-none rounded-full max-sm:w-1"
                style={{ background: i <= at ? alpha(color, 0.6) : "var(--color-line)" }}
              />
            )}
            <span
              className={cn(
                "flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap transition-[background-color,color] duration-500",
                on ? "font-semibold text-ink" : "text-ink-faint max-sm:px-2",
              )}
              style={on ? { background: alpha(color, 0.18), boxShadow: `inset 0 0 0 1px ${alpha(color, 0.35)}` } : {}}
            >
              <span
                className={cn("flex flex-none", on && s.step === "charging" && "animate-pulse-soft")}
                style={on ? { color } : undefined}
              >
                <Icon name={s.icon} size={15} />
              </span>
              <span className={cn(!on && "max-sm:sr-only")}>{s.label}</span>
              {on && detail && <span className="truncate font-normal text-ink-muted">· {detail}</span>}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
