import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/** How an integration reaches what it reads: on the home network, over Bluetooth, through a company's cloud, or
 * from public data. */
export type Reach = "local" | "bluetooth" | "cloud" | "public";

export const REACH: Record<Reach, { label: string; icon: IconName; title: string }> = {
  local: { label: "On your network", icon: "wifi", title: "Read straight from the device on your home network" },
  bluetooth: { label: "Bluetooth", icon: "bluetooth", title: "Read straight from the device over Bluetooth" },
  cloud: {
    label: "Cloud",
    icon: "cloud",
    title: "Read through its maker's cloud: it can lag, and stops while their service is down",
  },
  public: { label: "Public data", icon: "globe", title: "Public data from the internet: no account needed" },
};

/** A quiet tag saying how an integration is read ("On your network", "Cloud"). */
export function ReachTag({ reach, className }: { reach: Reach; className?: string }) {
  const r = REACH[reach];
  return (
    <span
      title={r.title}
      className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap text-ink-faint", className)}
    >
      <Icon name={r.icon} size={12} />
      {r.label}
    </span>
  );
}

/** A quiet tag for an integration read from what its maker documents, not yet tried on a real one. */
export function UntestedTag({ className }: { className?: string }) {
  return (
    <span
      title="Read from what its maker documents, but not yet tried on a real one. If anything looks off, an issue saying so gets it checked."
      className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap text-warn", className)}
    >
      <Icon name="flask" size={12} />
      Untested
    </span>
  );
}
