import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, longDate } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { deviceRawQuery, homeHintsQuery, homeQuery } from "~/features/home/api";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice, HomeIntegration, HomeOverview } from "~/features/home/types";
import { GroupInput } from "~/features/home/components/GroupInput";
import { groupNames, integrationIcon, kindIcon, nowLine, suggestedGroup } from "~/features/home/utils";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** The integration's own form: whatever it asks for (an email and password, an address…). */
function SignInForm({
  integration,
  again,
  onDone,
  className,
}: {
  integration: HomeIntegration;
  again?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const { connect, signIn } = useHomeChange();
  const send = again ? signIn : connect;
  const [form, setForm] = useState<Record<string, string>>({});
  const network = useQuery({ ...homeHintsQuery, enabled: integration.fields.some((f) => f.key === "where") }).data
    ?.network;
  const ready = integration.fields.every((f) => f.optional || form[f.key]?.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate({ id: integration.id, form }, { onSuccess: () => (setForm({}), onDone?.()) });
  };
  return (
    <form onSubmit={submit} className={cn("flex max-w-[460px] flex-col gap-4", className)}>
      {integration.fields.map((f) => (
        <Field
          key={f.key}
          label={
            <>
              {f.label}
              {f.optional && <span className="ml-1.5 font-normal text-ink-muted">optional</span>}
            </>
          }
          help={f.help || undefined}
        >
          <Input
            type={f.type}
            autoComplete={f.secret ? "off" : f.type === "email" ? "email" : "off"}
            spellCheck={false}
            placeholder={(f.key === "where" && network ? `${network} if left empty` : f.placeholder) || undefined}
            value={form[f.key] ?? ""}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            invalid={send.isError}
          />
        </Field>
      ))}
      {send.isError && <HelpText tone="bad">{errorMessage(send.error)}</HelpText>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!ready || send.isPending}>
          {send.isPending ? `Connecting to ${integration.name}…` : again ? "Sign in" : "Connect"}
        </Button>
        {again && onDone && (
          <Button variant="muted-link" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function accountStatus(i: HomeIntegration): [label: string, on: boolean] {
  const a = i.account!;
  if (a.signed_out) return ["Sign in again", false];
  if (a.error) return ["Not updating", false];
  if (!a.last_poll) return ["Connecting", false];
  return ["Connected", true];
}

/** The connected account: how it's doing, signing in again, and disconnecting. */
function Account({ integration }: { integration: HomeIntegration }) {
  const { disconnect, find } = useHomeChange();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [signing, setSigning] = useState(false);
  const a = integration.account!;
  const [status, on] = accountStatus(integration);
  return (
    <>
      <IntegrationRow
        icon={integrationIcon(integration)}
        name={integration.name}
        on={on}
        status={status}
        detail={
          <>
            {[
              a.label,
              `${a.devices} ${a.devices === 1 ? "device" : "devices"}`,
              a.last_poll && `read ${hhmm(a.last_poll)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            {a.error && <span className="mt-0.5 block text-xs text-bad">{a.error}</span>}
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {integration.find_label && !a.signed_out && (
              <Button
                variant="outline"
                size="sm"
                disabled={find.isPending}
                onClick={() => find.mutate(integration.id, { onSuccess: (r) => toast(r.found.message) })}
              >
                {find.isPending ? "Looking…" : integration.find_label}
              </Button>
            )}
            {integration.fields.length > 0 && !signing && (
              <Button variant={a.signed_out ? "primary" : "outline"} size="sm" onClick={() => setSigning(true)}>
                Sign in again
              </Button>
            )}
            {confirming ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(integration.id, {
                      onSuccess: () => (setConfirming(false), toast(`Disconnected from ${integration.name}.`)),
                    })
                  }
                >
                  {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
                </Button>
                <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </div>
        }
      >
        {find.isError && (
          <div className="basis-full pl-[60px] max-sm:pl-0">
            <HelpText tone="bad">{errorMessage(find.error)}</HelpText>
          </div>
        )}
        {(confirming || disconnect.isError) && (
          <div className="basis-full pl-[60px] max-sm:pl-0">
            <HelpText tone={disconnect.isError ? "bad" : undefined}>
              {disconnect.isError
                ? errorMessage(disconnect.error)
                : `Its devices, and everything they've used and every run recorded, are removed from this server. To change the account or its password, sign in again instead: that keeps them.`}
            </HelpText>
          </div>
        )}
      </IntegrationRow>
      {signing && (
        <SignInForm
          integration={integration}
          again
          onDone={() => setSigning(false)}
          className="border-b border-line-subtle px-6 py-5"
        />
      )}
      <div className="px-6 py-4 text-[13px] text-ink-muted">
        Connected {longDate.format(new Date(a.connected_at * 1000))}. Read every{" "}
        {integration.poll_seconds >= 60
          ? `${Math.round(integration.poll_seconds / 60)} min`
          : `${integration.poll_seconds} s`}
        .
      </div>
    </>
  );
}

/** What the integration last sent for a device, to check how its properties are read. */
function Properties({ device }: { device: HomeDevice }) {
  const { data, isPending, error } = useQuery(deviceRawQuery(device.id));
  const toast = useToast();
  const text = data ? JSON.stringify(data.properties, null, 2) : "";
  return (
    <div className="flex basis-full flex-col gap-2 pl-[60px] max-sm:pl-0">
      {isPending && <HelpText>Loading…</HelpText>}
      {error && <HelpText tone="bad">{errorMessage(error)}</HelpText>}
      {data && (
        <>
          <HelpText>
            {data.ts ? `As read at ${hhmm(data.ts)}.` : "Not read since the dashboard started."} Share these when a
            device reads wrongly, so its properties can be mapped.
          </HelpText>
          <pre className="m-0 max-h-[320px] overflow-auto rounded-xl bg-canvas p-3 font-mono text-xs leading-5 text-ink-soft">
            {text}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Copied."))}
          >
            Copy
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * For an appliance that doesn't report its power (a Hisense washer or dryer): showing what its runs usually draw while
 * it runs, once enough runs have finished with their energy.
 */
function Estimate({ device }: { device: HomeDevice }) {
  const { update } = useHomeChange();
  const e = device.estimate!;
  const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;
  return (
    <div className="flex basis-full flex-col gap-1.5 pl-[60px] max-sm:pl-0">
      <label className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Switch
          on={e.on}
          label="Estimate its power while it runs"
          disabled={update.isPending}
          onChange={(on) => update.mutate({ id: device.id, estimate: on })}
        />
        Estimate its power while it runs
      </label>
      <HelpText>
        {e.w != null
          ? `It only says what a run used once it's finished. With this on, while it runs it shows what its runs usually draw: about ${kW(e.w)}, from its last ${runs(e.runs)}. That's only shown: what's counted is still what it reports at the end.`
          : `It only says what a run used once it's finished. Once ${runs(e.needs)} have finished with their energy (${e.runs} so far), this can show what its runs usually draw while it runs.`}
      </HelpText>
    </div>
  );
}

/**
 * A device the account brought: rename it, say what it is, put it in a group, keep it out of the breakdown, estimate
 * its power while it runs (an appliance that doesn't report it), see what it sends.
 */
function DeviceRow({
  device,
  kinds,
  groups,
}: {
  device: HomeDevice;
  kinds: HomeOverview["kinds"];
  groups: Map<string, number>;
}) {
  const { update } = useHomeChange();
  const [name, setName] = useState(device.name);
  const [raw, setRaw] = useState(false);
  const now = nowLine(device);
  const save = () => name.trim() && name.trim() !== device.name && update.mutate({ id: device.id, name: name.trim() });
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line-subtle px-6 py-5 last:border-b-0">
      <span className="flex size-11 flex-none items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name={kindIcon(device.kind)} size={22} />
      </span>
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <Input
          aria-label="Name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), save())}
          boxClassName="h-9 max-w-[320px]"
        />
        <span className="text-[13px] text-ink-muted">{[device.model, now.text].filter(Boolean).join(" · ")}</span>
      </div>
      <Select
        aria-label="What it is"
        className="w-[190px]"
        value={device.kind}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ id: device.id, kind: e.target.value })}
      >
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </Select>
      <GroupInput
        key={device.group ?? ""}
        className="w-[190px]"
        value={device.group}
        groups={groups}
        suggestion={suggestedGroup(device.name)}
        disabled={update.isPending}
        onChange={(group) => update.mutate({ id: device.id, group })}
      />
      <label className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Switch
          on={!device.hidden}
          label="Show in the breakdown"
          disabled={update.isPending}
          onChange={(on) => update.mutate({ id: device.id, hidden: !on })}
        />
        In the breakdown
      </label>
      <Button variant="icon" size="sm" title="What it sends" aria-pressed={raw} onClick={() => setRaw(!raw)}>
        <Icon name="code" size={16} />
      </Button>
      {device.estimate && <Estimate device={device} />}
      {update.isError && (
        <div className="basis-full pl-[60px] max-sm:pl-0">
          <HelpText tone="bad">{errorMessage(update.error)}</HelpText>
        </div>
      )}
      {raw && <Properties device={device} />}
    </div>
  );
}

/**
 * Manage → Integrations → a smart-home integration (Tapo, Shelly, Home Assistant, Hisense through ConnectLife, Bluetti,
 * EcoFlow; the demo in mock mode): connect
 * its account, and the devices it brought.
 */
export function HomeIntegrationSettings({ id }: { id: string }) {
  const { data, isPending, error } = useQuery(homeQuery);
  const integration = data?.integrations.find((i) => i.id === id);
  const devices = (data?.devices ?? []).filter((d) => d.integration === id);
  const groups = groupNames(data?.devices ?? []); // a group can hold devices from any integration
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-home-integration"
        title={integration ? `${integration.name}` : "Smart home"}
        sub={integration?.about ?? ""}
      />
      <SettingsCard aria-labelledby="h-home-integration">
        {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking the connection…</div>}
        {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
        {data && !integration && <div className="px-6 py-5 text-sm text-bad">There's no such integration.</div>}
        {integration && !integration.account && (
          <div className="flex flex-col gap-4 px-6 py-5">
            {integration.id === "connectlife" && (
              <Notice tone="info">
                ConnectLife has no public API: this reads it the way its app does, so a change on Hisense's side can
                stop it working until it's updated here. Washers and dryers report each cycle's energy once it's
                finished, not their power as they run.
              </Notice>
            )}
            {integration.id === "electrolux" && (
              <Notice tone="info">
                Electrolux, AEG and +home appliances only talk to Electrolux's cloud (there's no way to reach them on
                your network), so this needs the internet. It only reads them. They don't report their power: a fridge
                shows its temperatures, doors and alerts, and the rest show when they run.
              </Notice>
            )}
            <SignInForm integration={integration} />
          </div>
        )}
        {integration?.account && <Account integration={integration} />}
      </SettingsCard>
      {integration?.account && data && (
        <SettingsCard aria-labelledby="h-home-devices">
          <div className="px-6 pt-6 pb-2">
            <SettingsTitle
              id="h-home-devices"
              title="Devices"
              sub={
                devices.length
                  ? "Name each one, and say what it is: a smart plug can be set as the appliance it powers, so its runs are recorded. Put plugs in the same room in a group, and the Home page shows them as one. Turn one out of the breakdown to leave it off the Home page."
                  : "Its devices appear here after the first reading, within a minute or so."
              }
            />
          </div>
          {devices.map((d) => (
            <DeviceRow key={d.id} device={d} kinds={data.kinds} groups={groups} />
          ))}
        </SettingsCard>
      )}
    </>
  );
}
