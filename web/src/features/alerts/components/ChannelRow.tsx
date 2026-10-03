import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { removeChannel, saveChannel, testChannel } from "~/features/alerts/api";
import type { AlertChannel, ChannelKind } from "~/features/alerts/types";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import type { IconName } from "~/features/common/ui/components/Icon";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";

const MASK = "••••";

type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  help?: ReactNode;
  /** Shown masked by the server; left as it is, the saved value is kept. */
  secret?: boolean;
};

const CHANNELS: Record<ChannelKind, { icon: IconName; detail: string; fields: FieldDef[] }> = {
  ntfy: {
    icon: "bell",
    detail: "Free notifications on your phone through the ntfy app, from ntfy.sh or your own ntfy server",
    fields: [
      {
        key: "url",
        label: "Topic address",
        placeholder: "https://ntfy.sh/your-topic",
        help: "Make the topic name hard to guess: on ntfy.sh, anyone who knows it can read your alerts. Then subscribe to the same topic in the ntfy app.",
      },
      {
        key: "token",
        label: "Access token (optional)",
        placeholder: "tk_…",
        help: "Only for a server that needs signing in: an access token, or username:password.",
        secret: true,
      },
    ],
  },
  pushover: {
    icon: "phone",
    detail: "Notifications through the Pushover app, a one-off purchase for each kind of device",
    fields: [
      { key: "user_key", label: "User key", help: "At the top of your Pushover dashboard.", secret: true },
      {
        key: "app_token",
        label: "App token",
        help: "Create an application in Pushover (call it WattsMyPower) and copy its API token.",
        secret: true,
      },
    ],
  },
  webhook: {
    icon: "webhook",
    detail: "Sends each alert as JSON to an address you choose, such as a Home Assistant automation",
    fields: [
      {
        key: "url",
        label: "Address",
        placeholder: "https://…",
        help: "Each alert is posted here with its event (alert, resolved, summary or test), title and message.",
        secret: true,
      },
      {
        key: "token",
        label: "Bearer token (optional)",
        help: "Sent in an Authorization header, if the address needs one.",
        secret: true,
      },
    ],
  },
};

/** Setting up or changing a channel, with a test send of what's in the form. Mounted while open. */
function ChannelForm({ channel, onClose }: { channel: AlertChannel; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const def = CHANNELS[channel.kind];
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...channel.config }));
  const [confirming, setConfirming] = useState(false);
  const changed = () => qc.invalidateQueries({ queryKey: ["alerts"] });

  const save = useMutation({
    mutationFn: () => saveChannel(channel.kind, { ...values, enabled: channel.configured ? channel.enabled : true }),
    onSuccess: () => {
      toast(`Saved. Alerts go to ${channel.label}.`);
      changed();
      onClose();
    },
  });
  const test = useMutation({ mutationFn: () => testChannel(channel.kind, values) });
  const remove = useMutation({
    mutationFn: () => removeChannel(channel.kind),
    onSuccess: () => {
      toast(`Removed ${channel.label}.`);
      changed();
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    test.reset();
    save.mutate();
  };
  const error = save.error ?? remove.error;

  return (
    <form onSubmit={submit} className="flex basis-full flex-col gap-4 pl-[60px] max-sm:pl-0">
      {def.fields.map((f) => (
        <Field key={f.key} label={f.label} help={f.help}>
          <Input
            value={values[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            // A masked secret is replaced, not edited: select it all on the way in.
            onFocus={(e) => f.secret && e.target.value.includes(MASK) && e.target.select()}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            inputMode={f.key === "url" ? "url" : undefined}
          />
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? "Sending…" : "Send a test"}
        </Button>
        <Button variant="muted-link" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {channel.configured &&
          (confirming ? (
            <span className="ml-auto flex items-center gap-3 max-sm:ml-0">
              <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? "Removing…" : `Remove ${channel.label}`}
              </Button>
              <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button variant="muted-link" size="sm" className="ml-auto max-sm:ml-0" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          ))}
      </div>
      <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
        {test.isSuccess && (
          <HelpText>Test sent. It should arrive in a few seconds; if it doesn't, check the details above.</HelpText>
        )}
        {test.isError && <HelpText tone="bad">{errorMessage(test.error)}</HelpText>}
        {error && <HelpText tone="bad">{errorMessage(error)}</HelpText>}
      </div>
    </form>
  );
}

/** A channel alerts can go to: whether it's set up and on, and its form. */
export function ChannelRow({ channel }: { channel: AlertChannel }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const def = CHANNELS[channel.kind];
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => saveChannel(channel.kind, { ...channel.config, enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const enabled = toggle.isPending ? toggle.variables : channel.enabled;
  const status = !channel.configured ? "Not set up" : enabled ? "On" : "Paused";

  return (
    <IntegrationRow
      icon={def.icon}
      name={channel.label}
      on={channel.configured && enabled}
      status={status}
      detail={
        <>
          {def.detail}
          {toggle.isError && <span className="mt-0.5 block text-xs text-bad">{errorMessage(toggle.error)}</span>}
        </>
      }
      action={
        open ? undefined : (
          <div className="flex items-center gap-4">
            {channel.configured && (
              <Switch
                on={enabled}
                onChange={(on) => toggle.mutate(on)}
                disabled={toggle.isPending}
                label={`Send alerts to ${channel.label}`}
              />
            )}
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {channel.configured ? "Change" : "Set up"}
            </Button>
          </div>
        )
      }
    >
      {open && <ChannelForm channel={channel} onClose={() => setOpen(false)} />}
    </IntegrationRow>
  );
}
