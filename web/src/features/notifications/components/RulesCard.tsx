import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Collapse } from "~/features/common/ui/components/Collapse";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { Switch } from "~/features/common/ui/components/Switch";
import { cn } from "~/features/common/ui/utils";
import { notificationsQuery, saveRule } from "~/features/notifications/api";
import type { Channel, ChannelKind, ChannelState, Rule } from "~/features/notifications/types";
import { SettingsSection } from "~/features/settings/components/SettingsSection";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "push", label: "Devices" },
  { id: "ntfy", label: "ntfy" },
  { id: "webhook", label: "Webhook" },
];

/** What you're told about: each rule on or off, with its numbers and which channels it uses. */
export function RulesCard({
  rules,
  channels,
  hasDevices,
}: {
  rules: Rule[];
  channels: Record<ChannelKind, ChannelState>;
  hasDevices: boolean;
}) {
  return (
    <SettingsSection
      id="h-rules"
      title="What to tell you"
      sub="Each one can be switched off, and has its own numbers. A problem has to last a few minutes before it's reported, and the same one is only reported again after its wait."
    >
      <ul className="m-0 flex list-none flex-col divide-y divide-line-subtle p-0">
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} channels={channels} hasDevices={hasDevices} />
        ))}
      </ul>
    </SettingsSection>
  );
}

function RuleRow({
  rule,
  channels,
  hasDevices,
}: {
  rule: Rule;
  channels: Record<ChannelKind, ChannelState>;
  hasDevices: boolean;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(rule.values).map(([k, v]) => [k, String(v)])),
  );
  const [used, setUsed] = useState<Channel[] | null>(rule.channels);
  const save = useMutation({
    mutationFn: (body: Parameters<typeof saveRule>[1]) => saveRule(rule.id, body),
    onSuccess: (fresh) => qc.setQueryData(notificationsQuery.queryKey, fresh),
  });
  const shown = save.isPending && save.variables?.enabled != null ? save.variables.enabled : rule.enabled;
  const open = (id: Channel) => (used ?? CHANNELS.map((c) => c.id)).includes(id);
  const dirty =
    rule.settings.some((s) => Number(values[s.key]) !== rule.values[s.key]) ||
    JSON.stringify(used) !== JSON.stringify(rule.channels);
  const available = (id: Channel) => (id === "push" ? hasDevices : channels[id].enabled);

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            {rule.name}
            {rule.urgent && (
              <Pill tone="bad" size="sm">
                Urgent
              </Pill>
            )}
            {rule.active_since != null && (
              <Pill tone="neutral" size="sm">
                Happening now
              </Pill>
            )}
          </span>
          <span className="text-[13px] leading-5 text-ink-muted">{rule.description}</span>
        </div>
        <Switch
          on={shown}
          label={`${rule.name} notifications`}
          disabled={save.isPending}
          onChange={(enabled) => save.mutate({ enabled })}
        />
      </div>
      <Collapse open={shown} className="flex flex-col gap-4">
        {rule.settings.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-3 sm:gap-4">
            {rule.settings.map((s) => (
              <label key={s.key} className="flex min-w-[130px] flex-1 flex-col gap-1.5 text-[13px] text-ink-muted">
                {s.label}
                <Input
                  type="number"
                  inputMode="decimal"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  unit={s.unit}
                  value={values[s.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}
        <fieldset className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-0 p-0">
          <legend className="sr-only">Send {rule.name} through</legend>
          <span className="w-full text-[13px] text-ink-muted sm:w-auto">Send through</span>
          {CHANNELS.map((c) => (
            <label
              key={c.id}
              className={cn("flex items-center gap-2 text-[13px]", !available(c.id) && "text-ink-faint")}
              title={available(c.id) ? undefined : "Not set up yet"}
            >
              <input
                type="checkbox"
                checked={open(c.id)}
                onChange={(e) => {
                  const now = new Set(used ?? CHANNELS.map((x) => x.id));
                  if (e.target.checked) now.add(c.id);
                  else now.delete(c.id);
                  setUsed(CHANNELS.map((x) => x.id).filter((id) => now.has(id)));
                }}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
        {dirty && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  values: Object.fromEntries(rule.settings.map((s) => [s.key, Number(values[s.key])])),
                  channels: used,
                })
              }
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
        {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
      </Collapse>
    </li>
  );
}
