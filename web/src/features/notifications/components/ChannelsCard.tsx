import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { notificationsQuery, removeChannel, saveChannel, sendTest } from "~/features/notifications/api";
import type { ChannelField, ChannelKind, ChannelState, Notifications } from "~/features/notifications/types";
import { SettingsSection } from "~/features/settings/components/SettingsSection";

const ABOUT: Record<ChannelKind, { name: string; blurb: string; placeholder: Record<string, string> }> = {
  ntfy: {
    name: "ntfy",
    blurb:
      "Free notifications to your phone through the ntfy app (iPhone and Android). Pick a topic name nobody would guess, subscribe to it in the app, and put its address here. No account needed.",
    placeholder: { url: "https://ntfy.sh/your-secret-topic", token: "Only if it needs a login" },
  },
  webhook: {
    name: "Webhook",
    blurb:
      "Posts each notification as JSON to an address you give it. Handy for Home Assistant, Discord or Slack (use their webhook address), or your own script.",
    placeholder: { url: "https://…", token: "Only if it needs one" },
  },
};

/** Where notifications go besides devices: ntfy and a webhook. */
export function ChannelsCard({
  channels,
  fields,
}: {
  channels: Record<ChannelKind, ChannelState>;
  fields: Record<ChannelKind, ChannelField[]>;
}) {
  return (
    <SettingsSection
      id="h-channels"
      title="Other places to send them"
      sub="Free, and quick to set up. Each can be used by some notifications and not others."
    >
      <div className="flex flex-col gap-6">
        {(Object.keys(ABOUT) as ChannelKind[]).map((kind) => (
          <ChannelForm key={kind} kind={kind} state={channels[kind]} fields={fields[kind]} />
        ))}
      </div>
    </SettingsSection>
  );
}

function ChannelForm({ kind, state, fields }: { kind: ChannelKind; state: ChannelState; fields: ChannelField[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const about = ABOUT[kind];
  const saved = Object.keys(state.config).length > 0;
  const [draft, setDraft] = useState<Record<string, string>>(state.config);
  const [enabled, setEnabled] = useState(saved ? state.enabled : true);
  // Saved: anything changed. Not yet: something typed.
  const dirty = saved
    ? fields.some((f) => (draft[f.key] ?? "") !== (state.config[f.key] ?? "")) || enabled !== state.enabled
    : fields.some((f) => (draft[f.key] ?? "") !== "");
  const done = (fresh: Notifications) => qc.setQueryData(notificationsQuery.queryKey, fresh);
  const save = useMutation({
    mutationFn: () => saveChannel(kind, { ...draft, enabled }),
    onSuccess: (fresh) => {
      done(fresh);
      toast(`${about.name} saved.`);
    },
  });
  const test = useMutation({ mutationFn: () => sendTest(kind) });
  const remove = useMutation({
    mutationFn: () => removeChannel(kind),
    onSuccess: (fresh) => {
      done(fresh);
      setDraft({});
      toast(`${about.name} removed.`);
    },
  });
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            {about.name}
            {saved && (
              <Pill tone={state.enabled ? "ok" : "neutral"} size="sm">
                {state.enabled ? "On" : "Off"}
              </Pill>
            )}
          </span>
          <span className="text-[13px] leading-5 text-ink-muted">{about.blurb}</span>
        </div>
        {saved && <Switch on={enabled} label={`${about.name} on or off`} onChange={setEnabled} />}
      </div>
      {fields.map((f) => (
        <Field key={f.key} label={f.label + (f.required ? "" : " (optional)")}>
          <Input
            value={draft[f.key] ?? ""}
            placeholder={about.placeholder[f.key]}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {saved && !dirty && (
          <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Sending…" : "Send a test"}
          </Button>
        )}
        {saved && (
          <Button variant="muted-link" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
        {test.isSuccess && <HelpText>Test sent. It should arrive in a few seconds.</HelpText>}
        {test.isError && <HelpText tone="bad">{errorMessage(test.error)}</HelpText>}
        {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
        {remove.isError && <HelpText tone="bad">{errorMessage(remove.error)}</HelpText>}
      </div>
    </div>
  );
}
