import { COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { TeslaProvider } from "~/features/ev/types";

const WAYS: Record<TeslaProvider, { icon: IconName; name: string; where: string; color: string; title: string }> = {
  bluetooth: {
    icon: "bluetooth",
    name: "Bluetooth",
    where: "Local",
    color: COLOR.battery,
    title: "Read over this server's Bluetooth: nothing leaves home",
  },
  tessie: {
    icon: "cloud",
    name: "Tessie",
    where: "Cloud",
    color: COLOR.lilac,
    title: "Read through Tessie, from anywhere",
  },
};

/** How the cars are reached, as a chip: the Bluetooth mark and "Bluetooth · Local", or "Tessie · Cloud". */
export function ProviderChip({ provider, className }: { provider: TeslaProvider; className?: string }) {
  const w = WAYS[provider];
  return (
    <span
      title={w.title}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-chip-line bg-chip py-1 pr-3 pl-2 font-sans text-[13px] leading-none font-semibold whitespace-nowrap text-ink",
        className,
      )}
    >
      <span
        className="flex size-5 items-center justify-center rounded-full"
        style={{ color: w.color, background: `color-mix(in srgb, ${w.color} 16%, transparent)` }}
      >
        <Icon name={w.icon} size={13} />
      </span>
      {w.name}
      <span className="font-medium text-ink-faint">· {w.where}</span>
    </span>
  );
}
