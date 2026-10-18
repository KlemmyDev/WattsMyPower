import { useState, useSyncExternalStore } from "react";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import {
  dismissInstall,
  install,
  installDismissed,
  installState,
  subscribeInstall,
  type InstallState,
} from "~/features/notifications/utils/install";

/**
 * Offers to save the dashboard to the home screen as an app: the browser's own prompt where there is one (Chrome,
 * Edge, Android), else the steps for an iPhone or iPad, where it's also the only way to get notifications. Nothing
 * once it's installed, or where the browser can't. `dismissible`: with a "Not now" that keeps it away on this device.
 */
export function InstallPrompt({ dismissible = false, why }: { dismissible?: boolean; why?: string }) {
  const state = useSyncExternalStore<InstallState | null>(subscribeInstall, installState, () => null);
  const dismissed = useSyncExternalStore(subscribeInstall, installDismissed, () => true);
  const [busy, setBusy] = useState(false);
  if (state == null || state === "installed" || state === "none") return null;
  if (dismissible && dismissed) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[22px] border border-line-subtle bg-surface px-5 py-4">
      <span className="flex size-11 flex-none items-center justify-center self-start rounded-full bg-canvas text-ink">
        <Icon name="phone" size={22} />
      </span>
      <div className="flex min-w-0 flex-1 basis-[calc(100%-4.5rem)] flex-col gap-0.5 sm:basis-0">
        <span className="text-[15px] font-semibold">Add WattsMyPower to your home screen</span>
        <span className="text-[13px] leading-5 text-ink-muted">
          {state === "ios"
            ? "Tap Share, then Add to Home Screen, and open it from there. It opens like an app, and it's the only way an iPhone allows notifications."
            : "It opens like an app, with no browser bars, and notifications can reach you."}
          {state === "prompt" && why ? ` ${why}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 max-sm:w-full">
        {state === "prompt" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await install();
              } finally {
                setBusy(false);
              }
            }}
          >
            Install
          </Button>
        )}
        {dismissible && (
          <Button variant="muted-link" size="sm" onClick={dismissInstall}>
            Not now
          </Button>
        )}
      </div>
    </div>
  );
}
