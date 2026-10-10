import { alpha } from "~/features/common/theme/utils/colors";
import { cn } from "~/features/common/ui/utils";
import type { Channel } from "~/features/updates/types";
import { CHANNEL } from "~/features/updates/utils";

/** The release channel as a small pill in its own colour ("Nightly" in blue). */
export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const { label, color } = CHANNEL[channel];
  return (
    <span
      className={cn("rounded-full border px-1.5 py-px text-[10px] leading-4 font-semibold", className)}
      style={{ color, background: alpha(color, 0.12), borderColor: alpha(color, 0.3) }}
    >
      {label}
    </span>
  );
}

/** A dot in the channel's colour, to sit beside its name. */
export function ChannelDot({ channel }: { channel: Channel }) {
  return <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: CHANNEL[channel].color }} />;
}
