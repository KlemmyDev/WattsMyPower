import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { removePushDevice, savePushDevice, testPushDevice } from "~/features/alerts/api";
import type { PushDevice, PushOverview } from "~/features/alerts/types";
import {
  browserName,
  currentSubscription,
  deviceId,
  pushSupport,
  subscribe,
  subscribeSupport,
  type PushSupport,
} from "~/features/alerts/utils/push";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { useToast } from "~/features/common/ui/components/Toast";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

/** "14:05" today, else "Fri 2 Oct". */
function when(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toDateString() === new Date().toDateString() ? hhmm(ts) : shortDay.format(d);
}

const failed = (e: unknown, fallback: string) =>
  e instanceof Error && !("status" in e) ? e.message : errorMessage(e, fallback);

/** Why this browser can't have notifications, and what to do about it. */
function Blocked({ support }: { support: Exclude<PushSupport, "ready"> }): ReactNode {
  if (support === "insecure")
    return (
      <Notice tone="plain" className="flex flex-col gap-2 leading-5">
        <span>
          <strong className="font-semibold text-ink">Notifications need a secure (https://) address.</strong> Browsers
          only allow them on a secure page, and this dashboard is open over plain http://.
        </span>
        <span>
          The easiest way to get one is <strong className="font-semibold text-ink">Tailscale</strong>: install it on the
          server and on your phone, run <code className="font-mono text-xs">tailscale serve --bg 8080</code> on the
          server, and open the https://….ts.net address it shows. Nothing is opened up to the internet. A reverse proxy
          with a certificate (such as Caddy) works too, and on the server itself, http://localhost does.
        </span>
        <span>Until then, ntfy (below) sends alerts to your phone without any of this.</span>
      </Notice>
    );
  if (support === "ios-install")
    return (
      <Notice tone="plain" className="leading-5">
        On an iPhone or iPad, notifications only work once the dashboard is on your home screen: tap{" "}
        <strong className="font-semibold text-ink">Share</strong>, then{" "}
        <strong className="font-semibold text-ink">Add to Home Screen</strong>, open WattsMyPower from there, and come
        back to Manage → Alerts.
      </Notice>
    );
  if (support === "denied")
    return (
      <Notice tone="plain" className="leading-5">
        Notifications are blocked for this site. Allow them in your browser&apos;s settings for this address, then
        reload the page.
      </Notice>
    );
  return (
    <Notice tone="plain" className="leading-5">
      This browser can&apos;t show notifications from websites. Chrome, Edge, Firefox and Safari can, or use ntfy below.
    </Notice>
  );
}

/** Manage → Alerts, the top: notifications on this browser, and every browser that has them. */
export function BrowserNotifications({ push }: { push: PushOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  // Worked out in the browser (the page shell is rendered ahead of time, without one), and again once permission has
  // been asked for.
  const support = useSyncExternalStore<PushSupport | null>(subscribeSupport, pushSupport, () => null);
  // This browser's subscription id, if it has one; undefined while that's being found out.
  const [found, setFound] = useState<string | null | undefined>(undefined);
  const mine = support === "ready" ? found : null;
  const changed = () => qc.invalidateQueries({ queryKey: ["alerts"] });

  useEffect(() => {
    if (support !== "ready") return;
    currentSubscription()
      .then((sub) => (sub ? deviceId(sub.endpoint) : null))
      .then(setFound, () => setFound(null));
  }, [support]);

  const on = mine != null && push.devices.some((d) => d.id === mine);
  const turnOn = useMutation({
    mutationFn: async () => {
      const sub = await subscribe(push.public_key);
      return savePushDevice(sub.toJSON(), browserName());
    },
    onSuccess: (device) => {
      setFound(device.id);
      toast("Notifications are on for this browser.");
      changed();
    },
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      if (mine) await removePushDevice(mine);
      await (await currentSubscription())?.unsubscribe();
    },
    onSuccess: () => {
      setFound(null);
      toast("Notifications are off for this browser.");
      changed();
    },
  });
  const test = useMutation({ mutationFn: (id: string) => testPushDevice(id) });

  const detail =
    support === null || mine === undefined
      ? "Checking this browser…"
      : on
        ? "Alerts arrive here as notifications, even with the dashboard closed."
        : support === "ready"
          ? "Get alerts as this device's own notifications, even with the dashboard closed. No app or account needed."
          : "Not available here yet.";

  return (
    <SettingsCard aria-labelledby="h-push">
      <div className="border-b border-line-subtle p-6 max-sm:p-5">
        <SettingsTitle
          id="h-push"
          title="Browser notifications"
          sub="Alerts as your phone's or computer's own notifications, from the browser you use the dashboard in."
        />
      </div>
      <div className="flex flex-col gap-4 border-b border-line-subtle px-6 py-5 max-sm:px-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-11 flex-none items-center justify-center rounded-full bg-canvas text-ink">
            <Icon name="bell" size={22} />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
              This browser
              {support === "ready" && mine !== undefined && (
                <Pill tone={on ? "ok" : "neutral"} size="sm">
                  {on ? "On" : "Off"}
                </Pill>
              )}
            </div>
            <span className="text-[13px] text-ink-muted">{detail}</span>
          </div>
          {support === "ready" && mine !== undefined && (
            <div className="flex flex-wrap items-center gap-3">
              {on ? (
                <>
                  <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate(mine)}>
                    {test.isPending ? "Sending…" : "Send a test"}
                  </Button>
                  <Button variant="muted-link" size="sm" disabled={turnOff.isPending} onClick={() => turnOff.mutate()}>
                    {turnOff.isPending ? "Turning off…" : "Turn off"}
                  </Button>
                </>
              ) : (
                <Button size="sm" disabled={turnOn.isPending} onClick={() => turnOn.mutate()}>
                  {turnOn.isPending ? "Turning on…" : "Turn on notifications"}
                </Button>
              )}
            </div>
          )}
        </div>
        {support && support !== "ready" && <Blocked support={support} />}
        <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
          {test.isSuccess && test.variables === mine && (
            <HelpText>Test sent. It should pop up in a few seconds.</HelpText>
          )}
          {test.isError && test.variables === mine && <HelpText tone="bad">{errorMessage(test.error)}</HelpText>}
          {turnOn.isError && (
            <HelpText tone="bad">{failed(turnOn.error, "Notifications couldn't be turned on. Try again.")}</HelpText>
          )}
          {turnOff.isError && <HelpText tone="bad">{errorMessage(turnOff.error)}</HelpText>}
        </div>
      </div>
      {push.devices.length > 0 && (
        <div className="flex flex-col">
          <h3 className="px-6 pt-4 pb-1 text-xs font-semibold tracking-wide text-ink-label uppercase max-sm:px-5">
            Getting notifications
          </h3>
          <ul className="m-0 list-none p-0">
            {push.devices.map((d) => (
              <DeviceRow key={d.id} device={d} mine={d.id === mine} />
            ))}
          </ul>
        </div>
      )}
    </SettingsCard>
  );
}

/** A browser getting notifications: when it was added, how the last one went, a test, and removing it. */
function DeviceRow({ device: d, mine }: { device: PushDevice; mine: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const test = useMutation({ mutationFn: () => testPushDevice(d.id) });
  const remove = useMutation({
    mutationFn: () => removePushDevice(d.id),
    onSuccess: () => {
      toast(`${d.name} won't get notifications any more.`);
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle px-6 py-4 first:border-t-0 max-sm:px-5">
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {d.name}
          {mine && (
            <Pill tone="brand" size="sm">
              This browser
            </Pill>
          )}
        </span>
        <span className="text-xs text-ink-muted">
          Added {when(d.created_at)}
          {d.last_sent ? ` · last notified ${when(d.last_sent)}` : " · nothing sent yet"}
        </span>
        {d.last_error && <span className="text-xs text-bad">{d.last_error}</span>}
        {test.isSuccess && <HelpText>Test sent.</HelpText>}
        {(test.error ?? remove.error) && <HelpText tone="bad">{errorMessage(test.error ?? remove.error)}</HelpText>}
      </div>
      {!mine && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Sending…" : "Send a test"}
          </Button>
          <Button variant="muted-link" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}
