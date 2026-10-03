import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { amberQuery } from "~/features/amber/api";
import { useAmberChange, useAmberPrices } from "~/features/amber/hooks";
import type { AmberStatus } from "~/features/amber/types";
import { priceLabel, syncLine } from "~/features/amber/utils";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, longDate } from "~/features/common/formatting/utils/date";
import { tariffQuery } from "~/features/common/tariffs/api";
import { useNow } from "~/features/common/time/hooks";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { useToast } from "~/features/common/ui/components/Toast";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const day = (ts: number) => longDate.format(new Date(ts * 1000));

function ConnectForm() {
  const { connect } = useAmberChange();
  const [key, setKey] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) connect.mutate(key.trim(), { onSuccess: () => setKey("") });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-6 py-5">
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

function SitePicker({ status }: { status: AmberStatus }) {
  const { site } = useAmberChange();
  if (status.sites.length < 2 && status.site_id) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-line-subtle px-6 py-5">
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
          onChange={(e) => e.target.value && site.mutate(e.target.value)}
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
 * Settings → Tariffs: connecting Amber Electric, whose prices change every 5 or 30 minutes. Optional:
 * until a key is pasted here, nothing calls Amber and no cost uses its prices.
 */
export function AmberSettings({ onUse }: { onUse: () => void }) {
  const now = useNow();
  const { data: status, isPending, error } = useQuery(amberQuery);
  const tariff = useQuery(tariffQuery).data;
  const prices = useAmberPrices(now);
  const { disconnect } = useAmberChange();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const ready = !!status?.site_id;
  const length = status?.interval_length;

  return (
    <SettingsCard aria-labelledby="h-amber">
      <div className="border-b border-line-subtle p-6">
        <SettingsTitle
          id="h-amber"
          title="Amber Electric"
          sub="With Amber, the price of power changes every 5 or 30 minutes. Connect your account to cost your power at the price of the time."
        />
      </div>
      {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking the connection…</div>}
      {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
      {status && !status.connected && <ConnectForm />}
      {status?.connected && (
        <>
          <IntegrationRow
            icon="dollar"
            name="Amber"
            on={ready && !status.error}
            status={!ready ? "Choose a site" : status.error ? "Not updating" : "Connected"}
            detail={
              <>
                API key {status.key}
                {ready && (
                  <>
                    {" "}
                    · {length ? `${length}-minute prices` : "Prices"} · {syncLine(status, day)}
                    {status.last_sync && ` · updated ${hhmm(status.last_sync)}`}
                  </>
                )}
                {status.error && <span className="mt-0.5 block text-xs text-bad">{status.error}</span>}
              </>
            }
            action={
              confirming ? (
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disconnect.isPending}
                    onClick={() =>
                      disconnect.mutate(undefined, {
                        onSuccess: () => {
                          setConfirming(false);
                          toast("Disconnected from Amber.");
                        },
                      })
                    }
                  >
                    {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
                  </Button>
                  <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  Disconnect
                </Button>
              )
            }
          >
            {(confirming || disconnect.isError) && (
              <div className="basis-full pl-[60px] max-sm:pl-0">
                <HelpText tone={disconnect.isError ? "bad" : undefined}>
                  {disconnect.isError
                    ? errorMessage(disconnect.error)
                    : "The API key and Amber's prices are removed from this server. If your rates use Amber prices, they go back to a single rate at your fallback rates."}
                </HelpText>
              </div>
            )}
          </IntegrationRow>
          <SitePicker status={status} />
          {ready && (
            <div className="flex flex-col gap-4 px-6 py-5">
              {prices && (
                <div className="text-sm text-ink-muted tabular-nums">
                  Right now:{" "}
                  <b className="font-semibold text-ink">
                    {prices.now.general != null ? priceLabel(prices.now.general) : "—"}
                  </b>{" "}
                  per kWh from the grid, and{" "}
                  <b className="font-semibold text-ink">
                    {prices.now.feed_in != null ? priceLabel(prices.now.feed_in) : "—"}
                  </b>{" "}
                  for feed-in. Today's prices are on the Overview.
                </div>
              )}
              {tariff && tariff.type !== "amber" && (
                <Notice tone="info" className="flex flex-wrap items-center justify-between gap-3">
                  <span>Your rates don't use Amber's prices yet.</span>
                  <Button size="sm" variant="outline" onClick={onUse}>
                    Use Amber prices
                  </Button>
                </Notice>
              )}
            </div>
          )}
        </>
      )}
    </SettingsCard>
  );
}
