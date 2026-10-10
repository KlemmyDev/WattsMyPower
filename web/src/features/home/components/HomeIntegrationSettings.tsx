import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, longDate } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { homeHintsQuery, homeQuery } from "~/features/home/api";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice, HomeIntegration } from "~/features/home/types";
import { integrationIcon, integrationReach, kindIcon, nowLine } from "~/features/home/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { REACH } from "~/features/integrations/components/ReachTag";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
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

/** The integration at a glance: how it's doing, its devices, when it last read them, and how it reaches them. */
function Summary({ integration: i, devices }: { integration: HomeIntegration; devices: HomeDevice[] }) {
  const a = i.account;
  const [status, on] = a ? accountStatus(i) : ["Not connected", false];
  const reach = REACH[integrationReach(i)];
  const every = i.poll_seconds >= 60 ? `${Math.round(i.poll_seconds / 60)} min` : `${i.poll_seconds} s`;
  const running = devices.filter((d) => d.now?.online && (d.now.power_w ?? 0) > 0).length;
  return (
    <SummaryCard icon={integrationIcon(i)} color={a && !on ? COLOR.warn : COLOR.brand} label={i.name}>
      <SummaryStat label="Status" value={status} color={a && !on ? COLOR.warn : undefined} sub={a?.label} />
      <SummaryStat
        label="Devices"
        value={a ? devices.length : "—"}
        sub={a ? (running ? `${running} using power now` : "None using power now") : "Once it's connected"}
      />
      <SummaryStat label="Last read" value={a?.last_poll ? hhmm(a.last_poll) : "—"} sub={`Every ${every}`} />
      <SummaryStat label="Reached" value={reach.label} sub={i.via} title={reach.title} />
    </SummaryCard>
  );
}

/**
 * Manage → Integrations → Smart home → a brand (Tapo, Shelly, Home Assistant, Hisense through ConnectLife, Electrolux,
 * Bluetti, EcoFlow; the demo in mock mode): connecting its account, how it's going, and the devices it brought, each
 * opening to its own page.
 */
export function HomeIntegrationSettings({ id }: { id: string }) {
  const { data, isPending, error } = useQuery(homeQuery);
  const integration = data?.integrations.find((i) => i.id === id);
  const devices = (data?.devices ?? []).filter((d) => d.integration === id);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations/home">Smart home</BackLink>}
        id="h-home-integration"
        title={integration ? `${integration.name}` : "Smart home"}
        sub={integration?.about ?? ""}
      />
      {integration && <Summary integration={integration} devices={devices} />}
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking the connection…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {data && !integration && <p className="m-0 text-sm text-bad">There's no such integration.</p>}
      {integration && !integration.account && (
        <SettingsSection
          id="h-home-connect"
          title={`Connect ${integration.name}`}
          sub={`Read through ${integration.via}.`}
        >
          <div className="flex flex-col gap-4">
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
        </SettingsSection>
      )}
      {integration?.account && (
        <SettingsSection id="h-home-account" title="Account" sub="How it's signed in, and how it's going.">
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            <Account integration={integration} />
          </div>
        </SettingsSection>
      )}
      {integration?.account && data && (
        <SettingsSection
          id="h-home-devices"
          title="Devices"
          sub={
            devices.length
              ? "Open one to name it, say what it is (a smart plug as the appliance it powers), put it in a group, or leave it out of the breakdown."
              : "Its devices appear here after the first reading, within a minute or so."
          }
        >
          {devices.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
              {devices.map((d) => {
                const now = nowLine(d);
                const live = !!d.now && d.now.online && !d.now.stale;
                return (
                  <IntegrationLink
                    key={d.id}
                    to="/integrations/home/$integration/$device"
                    params={{ integration: id, device: String(d.id) }}
                    icon={kindIcon(d.kind)}
                    name={d.name}
                    status={
                      now.running
                        ? "Running"
                        : live
                          ? undefined
                          : d.now
                            ? d.now.online
                              ? "Not read"
                              : "Offline"
                            : "Waiting"
                    }
                    on={now.running}
                    detail={[data.kinds.find((k) => k.id === d.kind)?.label, d.group && `in ${d.group}`, now.text]
                      .filter(Boolean)
                      .join(" · ")}
                    tags={
                      d.hidden ? <span className="text-xs text-ink-faint">Left out of the breakdown</span> : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </SettingsSection>
      )}
    </>
  );
}
