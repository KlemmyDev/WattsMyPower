import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { amberQuery } from "~/features/amber/api";
import { useAmberChange } from "~/features/amber/hooks";
import type { AmberStatus } from "~/features/amber/types";
import { syncLine } from "~/features/amber/utils";
import { errorMessage } from "~/features/common/api/utils";
import { longDate } from "~/features/common/formatting/utils/date";
import { tariffQuery } from "~/features/common/tariffs/api";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { ConfirmAction } from "~/features/integrations/components/ConfirmAction";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const day = (ts: number) => longDate.format(new Date(ts * 1000));

function ConnectForm({ className, onConnected }: { className?: string; onConnected?: (s: AmberStatus) => void }) {
  const { connect } = useAmberChange();
  const [key, setKey] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim())
      connect.mutate(key.trim(), {
        onSuccess: (status) => {
          setKey("");
          onConnected?.(status);
        },
      });
  };
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-3", className)}>
      <Field
        label="API key"
        help={
          <>
            Create one in the Amber app or at{" "}
            <a href="https://app.amber.com.au/developers" target="_blank" rel="noreferrer">
              app.amber.com.au/developers
            </a>
            . It stays on this server and is never shown in full again.
          </>
        }
      >
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="psk_…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          invalid={connect.isError}
        />
      </Field>
      {connect.isError && <HelpText tone="bad">{errorMessage(connect.error)}</HelpText>}
      <Button type="submit" size="sm" className="self-start" disabled={!key.trim() || connect.isPending}>
        {connect.isPending ? "Checking with Amber…" : "Connect"}
      </Button>
    </form>
  );
}

function SitePicker({
  status,
  className,
  onChosen,
}: {
  status: AmberStatus;
  className?: string;
  onChosen?: () => void;
}) {
  const { site } = useAmberChange();
  if (status.sites.length < 2 && status.site_id) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Field
        label="Site"
        help={
          status.site_id ? "Prices are for this site's meter." : "Your account has more than one site. Choose yours."
        }
      >
        <Select
          className="max-w-[420px]"
          value={status.site_id ?? ""}
          disabled={site.isPending}
          onChange={(e) => e.target.value && site.mutate(e.target.value, { onSuccess: () => onChosen?.() })}
        >
          {!status.site_id && <option value="">Choose a site</option>}
          {status.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {[s.network, s.nmi && `NMI ${s.nmi}`, s.status !== "active" && s.status].filter(Boolean).join(" · ")}
            </option>
          ))}
        </Select>
      </Field>
      {site.isError && <HelpText tone="bad">{errorMessage(site.error)}</HelpText>}
    </div>
  );
}

/**
 * Connecting Amber in the set-up guide's plan step: the API key, then the site if the account has
 * several. `onReady` runs once prices can be fetched, so the step can switch the rates to Amber.
 */
export function AmberConnect({ onReady }: { onReady: () => void }) {
  const { data: status } = useQuery(amberQuery);
  if (!status) return null;
  if (!status.connected) return <ConnectForm onConnected={(s) => s.site_id && onReady()} />;
  if (!status.site_id) return <SitePicker status={status} onChosen={onReady} />;
  return (
    <HelpText className="text-[13px]">
      Connected to Amber (API key {status.key}). The connection is in Manage → Integrations → Amber Electric.
    </HelpText>
  );
}

/** The connection: the key it uses and when prices were last fetched, with disconnecting on the right. */
function AmberConnection({ status }: { status: AmberStatus }) {
  const { disconnect } = useAmberChange();
  const toast = useToast();
  return (
    <SettingsSection
      id="h-amber-connection"
      title="Connection"
      sub={
        <>
          API key {status.key}, through the internet.
          {status.site_id && <span className="block text-ink-faint">{syncLine(status, day)}</span>}
        </>
      }
      aside={
        <ConfirmAction
          label="Disconnect"
          doing="Disconnecting…"
          note="The API key and Amber's prices are removed from this server. If your rates use Amber prices, they go back to a single rate at your fallback rates."
          pending={disconnect.isPending}
          error={disconnect.error}
          run={(done) =>
            disconnect.mutate(undefined, {
              onSuccess: () => {
                done();
                toast("Disconnected from Amber.");
              },
            })
          }
        />
      }
    >
      {null}
    </SettingsSection>
  );
}

/**
 * Manage → Integrations → Amber Electric: connecting with an API key (optional: until one's pasted here, nothing calls
 * Amber and no cost uses its prices), then the site, whether the rates use its prices, and the connection itself.
 */
export function AmberSettings() {
  const { data: status, isPending, error } = useQuery(amberQuery);
  const tariff = useQuery(tariffQuery).data;
  const ready = !!status?.site_id;
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-amber"
        title="Amber Electric"
        sub="With Amber, the price of power changes every 5 or 30 minutes. Connect your account to cost your power at the price of the time."
      />
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking the connection…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {status && !status.connected && (
        <SettingsSection
          id="h-amber-connect"
          title="Connect Amber"
          sub="Its prices come from Amber's own API, through the internet: there's nothing to read on your network."
        >
          <ConnectForm />
        </SettingsSection>
      )}
      {status?.connected && (
        <>
          {status.error && <p className="m-0 text-sm text-bad">Not updating: {status.error}</p>}
          {(status.sites.length > 1 || !status.site_id) && (
            <SettingsSection id="h-amber-site" title="Site" sub="Which of your account's sites the prices are for.">
              <SitePicker status={status} />
            </SettingsSection>
          )}
          {ready && (
            <SettingsSection
              id="h-amber-rates"
              title="Your rates"
              sub="Costs, Bills and the Plan price your power at Amber's prices once your rates follow them."
              aside={
                tariff &&
                tariff.type !== "amber" && (
                  <ButtonLink to="/bills/rates" hash="rates" size="sm" variant="outline">
                    Use Amber's prices
                  </ButtonLink>
                )
              }
            >
              <p className="m-0 text-sm text-ink-muted">
                {tariff?.type === "amber"
                  ? "Your rates follow Amber's prices. Today's prices are on the Overview."
                  : "Your rates don't use Amber's prices yet: they're set in Bills → Rates & settings."}
              </p>
            </SettingsSection>
          )}
          <AmberConnection status={status} />
        </>
      )}
    </>
  );
}
