import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { alertsQuery, saveRule } from "~/features/alerts/api";
import { BrowserNotifications } from "~/features/alerts/components/BrowserNotifications";
import { ChannelRow } from "~/features/alerts/components/ChannelRow";
import type { AlertCategory, AlertEvent, AlertRule, RuleChange, RuleSetting } from "~/features/alerts/types";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { Switch } from "~/features/common/ui/components/Switch";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

/** "14:05" today, else "Fri 2 Oct 14:05". */
function when(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toDateString() === new Date().toDateString() ? hhmm(ts) : `${shortDay.format(d)} ${hhmm(ts)}`;
}

function cooldownText(hours: number): string {
  if (hours >= 24) return `${Math.round(hours / 24)} days`;
  return hours === 1 ? "hour" : `${hours} hours`;
}

/** A threshold, saved when it loses focus or Enter is pressed. Reset (by its key) when the saved value changes. */
function ThresholdInput({
  setting,
  disabled,
  onSave,
}: {
  setting: RuleSetting;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [text, setText] = useState(String(setting.value));
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== "" && v !== setting.value) onSave(v);
  };
  return (
    <Field label={setting.label} className="w-[220px] max-sm:w-full">
      <Input
        type="number"
        inputMode="numeric"
        min={setting.min}
        max={setting.max}
        step={1}
        value={text}
        unit={setting.unit}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

function RuleRow({ rule }: { rule: AlertRule }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (change: RuleChange) => saveRule(rule.id, change),
    onSuccess: (saved) => {
      qc.setQueryData(alertsQuery.queryKey, (o) =>
        o ? { ...o, rules: o.rules.map((r) => (r.id === saved.id ? saved : r)) } : o,
      );
    },
  });
  const enabled = save.isPending && save.variables.enabled !== undefined ? save.variables.enabled : rule.enabled;
  const titleId = `rule-${rule.id}`;

  return (
    <div className="flex flex-col gap-3 border-b border-line-subtle px-6 py-5 last:border-b-0">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span id={titleId} className="text-[15px] font-semibold">
              {rule.name}
            </span>
            {enabled && rule.active_since && rule.resolves && (
              <Pill tone="bad" size="sm">
                Since {when(rule.active_since)}
              </Pill>
            )}
            {rule.needs === "amber" && (
              <Pill tone="neutral" size="sm">
                Needs Amber
              </Pill>
            )}
          </div>
          <span className="text-[13px] leading-5 text-pretty text-ink-muted">{rule.description}</span>
        </div>
        <Switch
          on={enabled}
          onChange={(on) => save.mutate({ enabled: on })}
          aria-labelledby={titleId}
          className="mt-0.5"
        />
      </div>
      {enabled && (rule.settings.length > 0 || rule.cooldown_hours != null) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            {rule.settings.map((s) => (
              <ThresholdInput
                key={`${s.key}:${s.value}`}
                setting={s}
                disabled={save.isPending}
                onSave={(v) => save.mutate({ settings: { [s.key]: v } })}
              />
            ))}
          </div>
          {rule.cooldown_hours != null && (
            <HelpText>
              Sent at most once every {cooldownText(rule.cooldown_hours)}
              {!rule.resolves
                ? "."
                : rule.category === "system"
                  ? ", with a follow-up when it's fixed."
                  : ", with a follow-up when it's over."}
            </HelpText>
          )}
          {rule.needs === "amber" && (
            <HelpText>
              This watches Amber&apos;s prices, so it stays quiet until your rates are set to Amber in Settings →
              Tariffs.
            </HelpText>
          )}
        </div>
      )}
      {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
    </div>
  );
}

const STATUS: Record<AlertEvent["status"], string> = {
  sent: "Sent",
  partial: "Sent to some",
  failed: "Not delivered",
};

function HistoryRow({ event }: { event: AlertEvent }) {
  const tone = event.status === "failed" ? "bad" : event.kind === "alert" && !event.resolved_at ? "brand" : "neutral";
  return (
    <li className="flex flex-col gap-1 border-b border-line-subtle px-6 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold">{event.title}</span>
        <span className="text-xs text-ink-muted tabular-nums">{when(event.ts)}</span>
      </div>
      <p className="m-0 text-[13px] leading-5 wrap-anywhere whitespace-pre-line text-ink-muted">{event.message}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Pill tone={tone} size="sm">
          {STATUS[event.status]}
        </Pill>
        {event.kind === "alert" && (
          <span className="text-xs text-ink-faint">
            {event.resolved_at ? `Fixed after ${duration(event.resolved_at - event.ts)}` : "Not fixed yet"}
          </span>
        )}
      </div>
      {event.error && <span className="text-xs wrap-anywhere text-bad">{event.error}</span>}
    </li>
  );
}

/** A group of rules: its name and what it's about, then each rule. */
function RuleGroup({ category, rules }: { category: AlertCategory; rules: AlertRule[] }) {
  const on = rules.filter((r) => r.enabled).length;
  return (
    <section aria-labelledby={`h-rules-${category.id}`} className="border-b border-line-subtle last:border-b-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 bg-surface-inset px-6 pt-4 pb-3 max-sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={`h-rules-${category.id}`} className="text-[15px] font-semibold">
            {category.name}
          </h3>
          <span className="text-[13px] text-ink-muted">{category.description}</span>
        </div>
        <span className="text-xs text-ink-muted tabular-nums">
          {on} of {rules.length} on
        </span>
      </div>
      <div className="border-t border-line-subtle">
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>
    </section>
  );
}

/** Settings → Alerts: browser notifications, other places alerts can go, which ones to send, and what's been sent. */
export function AlertSettings() {
  const { data, isPending, error } = useQuery(alertsQuery);
  const history = data?.history ?? [];

  if (isPending) return <div className="px-1 text-sm text-ink-muted">Loading…</div>;
  if (error || !data) return <Notice>{errorMessage(error)}</Notice>;

  return (
    <>
      <BrowserNotifications push={data.push} />

      <SettingsCard aria-labelledby="h-channels">
        <div className="border-b border-line-subtle p-6 max-sm:p-5">
          <SettingsTitle
            id="h-channels"
            title="Other ways to get alerts"
            sub="Through an app on your phone, or to another system. Each one switched on gets every alert."
          />
        </div>
        {data.channels.map((c) => (
          <ChannelRow key={c.kind} channel={c} />
        ))}
      </SettingsCard>

      <SettingsCard aria-labelledby="h-rules">
        <div className="flex flex-col gap-4 border-b border-line-subtle p-6 max-sm:p-5">
          <SettingsTitle
            id="h-rules"
            title="What to tell you about"
            sub="Each is checked every minute or so, and only once it has lasted, so a passing blip stays quiet."
          />
          {!data.enabled && (
            <Notice tone="info">
              Alerts are off until they have somewhere to go: turn on browser notifications, or set up ntfy, Pushover or
              a webhook above.
            </Notice>
          )}
        </div>
        {data.categories.map((c) => {
          const rules = data.rules.filter((r) => r.category === c.id);
          return rules.length ? <RuleGroup key={c.id} category={c} rules={rules} /> : null;
        })}
      </SettingsCard>

      <SettingsCard aria-labelledby="h-history">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle p-6 max-sm:p-5">
          <SettingsTitle id="h-history" title="Recent alerts" sub="What was sent, and whether it arrived." />
        </div>
        {history.length ? (
          <ul className="m-0 list-none p-0">
            {history.map((e) => (
              <HistoryRow key={e.id} event={e} />
            ))}
          </ul>
        ) : (
          <div className="px-6 py-5 text-sm text-ink-muted">
            Nothing sent yet. Alerts show up here once they go out.
          </div>
        )}
      </SettingsCard>
    </>
  );
}
