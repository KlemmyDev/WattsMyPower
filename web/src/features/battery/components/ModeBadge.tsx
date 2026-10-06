import { useBatteryMode } from "~/features/battery/hooks";
import { describeMode, KIND_COLOR, modeIcon } from "~/features/battery/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/**
 * A small icon on the battery's ring saying what it's set to do (pause, shield, bolt, cloud, lock), in place of words
 * where room is short: the power-flow picture and the dock. Its full meaning is its tooltip and label. Nothing while
 * it's running as normal. Place it in a `relative` box; `ring` is the colour behind it, for the cut-out edge.
 */
export function ModeBadge({ now, ring, className }: { now: number; ring: string; className?: string }) {
  const mode = useBatteryMode();
  const icon = modeIcon(mode);
  if (!mode || !icon) return null;
  const { label, detail } = describeMode(mode, now);
  const text = detail ? `${label}, ${detail}` : label;
  const color = mode.kind && !mode.ending ? KIND_COLOR[mode.kind] : COLOR.warn;
  return (
    <span
      role="img"
      aria-label={`Battery: ${text}`}
      title={text}
      className={cn(
        "absolute -right-1 -bottom-1 z-1 flex size-[18px] items-center justify-center rounded-full border-2",
        className,
      )}
      style={{ background: color, borderColor: ring, color: "#fff" }}
    >
      <Icon name={icon} size={10} strokeWidth={2.75} />
    </span>
  );
}
