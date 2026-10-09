import { useState } from "react";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { BluetoothPair } from "~/features/ev/components/BluetoothPair";
import { TessieConnect } from "~/features/ev/components/TessieConnect";
import type { TeslaProvider, TeslaStatus } from "~/features/ev/types";

const WAYS: { id: TeslaProvider; icon: IconName; name: string; tag: string; about: string }[] = [
  {
    id: "bluetooth",
    icon: "bluetooth",
    name: "Bluetooth",
    tag: "Local",
    about: "This server talks to the car directly, while it's parked within range. No account, nothing leaves home.",
  },
  {
    id: "tessie",
    icon: "bolt",
    name: "Tessie",
    tag: "Cloud",
    about: "Through your Tessie account, from anywhere. Needs a Tessie subscription and the internet.",
  },
];

/**
 * Connecting a Tesla: over this server's Bluetooth, or through Tessie. Either way the dashboard can do the same (read
 * its charge, start and stop charging, change the current and the limit), so it's a choice of where it's reached
 * from. `only` shows just one way (switching to it from the other).
 */
export function TeslaConnect({
  className,
  only,
  onConnected,
}: {
  className?: string;
  only?: TeslaProvider;
  onConnected?: (s: TeslaStatus) => void;
}) {
  const [way, setWay] = useState<TeslaProvider>(only ?? "bluetooth");
  const shown = only ?? way;
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {!only && (
        <div role="radiogroup" aria-label="How to connect" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {WAYS.map((w) => {
            const on = w.id === way;
            return (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setWay(w.id)}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border bg-surface p-4 text-left transition-[border-color,box-shadow] duration-200",
                  on ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line-subtle hover:border-line",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex size-8 flex-none items-center justify-center rounded-full bg-canvas">
                    <Icon name={w.icon} size={17} />
                  </span>
                  <span className="text-[15px] font-semibold">{w.name}</span>
                  <span className="ml-auto rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                    {w.tag}
                  </span>
                </span>
                <span className="text-[13px] leading-5 text-ink-muted">{w.about}</span>
              </button>
            );
          })}
        </div>
      )}
      {shown === "bluetooth" ? <BluetoothPair onPaired={onConnected} /> : <TessieConnect onConnected={onConnected} />}
    </div>
  );
}
