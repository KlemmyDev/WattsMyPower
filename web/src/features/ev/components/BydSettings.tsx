import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { ReachTag, UntestedTag } from "~/features/integrations/components/ReachTag";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { bydQuery } from "~/features/ev/api";
import { BydConnect } from "~/features/ev/components/BydConnect";
import { NextRead } from "~/features/ev/components/NextRead";
import { useBydChange } from "~/features/ev/hooks";
import type { BydCar, BydStatus } from "~/features/ev/types";
import { STATUS_LABEL } from "~/features/ev/utils";

/** A BYD: its name and charge, which it is, what it's doing, and opening it on the EV page. */
function CarRow({ v }: { v: BydCar }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">
          {v.name ?? v.model ?? "BYD"}
          {v.state?.soc != null && (
            <span className="font-normal text-ink-muted tabular-nums"> · {Math.round(v.state.soc)}%</span>
          )}
        </span>
        <span className="font-mono text-xs text-ink-muted">
          {v.model && <span className="font-sans">{[v.year, v.model].filter(Boolean).join(" ")} · </span>}
          {v.vin}
          <span className="font-sans">
            {" "}
            · {STATUS_LABEL[v.status].toLowerCase()}
            {v.state?.as_of ? ` · read ${hhmm(v.state.as_of)}` : ""}
          </span>
        </span>
      </div>
      <ButtonLink to="/ev/$vin" params={{ vin: v.vin }} size="sm" variant="outline">
        Open
      </ButtonLink>
    </div>
  );
}

/** The account (its email, partly hidden) and when it was read, with reading it now and disconnecting. */
function Connection({ status }: { status: BydStatus }) {
  const { refresh, disconnect } = useBydChange();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const region = status.regions.find((r) => r.code === status.region)?.name;
  return (
    <SettingsSection
      id="h-byd-connection"
      title="Connected through BYD's cloud"
      sub={
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>
            As {status.account}
            {region ? ` (${region})` : ""}.{" "}
            {status.reading ? "Reading now…" : status.read_at ? `Last read at ${hhmm(status.read_at)}.` : ""}
          </span>
          <NextRead status={status} className="text-[13px]" />
        </span>
      }
      aside={
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
                    toast("Disconnected from BYD.");
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={refresh.isPending || status.reading || status.signed_out}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? "Reading…" : "Read now"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          </div>
        )
      }
    >
      {confirming && (
        <HelpText>
          The email and password are removed from this server, and the dashboard stops reading the cars. Nothing changes
          in the cars or the BYD app.
        </HelpText>
      )}
      {(refresh.isError || disconnect.isError) && (
        <HelpText tone="bad">{errorMessage(refresh.error ?? disconnect.error)}</HelpText>
      )}
    </SettingsSection>
  );
}

/**
 * Manage → Integrations → Electric vehicles → BYD: signing in to BYD's cloud (the only way to reach a BYD: there's no
 * local one), each car on the account, and what the dashboard can and can't do with them (it only reads them).
 */
export function BydSettings() {
  const { data: status, isPending, error } = useQuery(bydQuery);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations/ev">Electric vehicles</BackLink>}
        id="h-byd"
        title="BYD"
        sub="See each car's charge, range and charging on the EV page, beside the rest of your home's energy."
      />
      <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ReachTag reach="cloud" />
        <UntestedTag />
      </div>
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking the connection…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {status && !status.connected && (
        <SettingsSection
          id="h-byd-connect"
          title="Connect your BYD"
          sub="Atto 3, Dolphin, Seal, Sealion, Shark and the other BYDs in the BYD app. The dashboard reads them through BYD's cloud, as the app does: BYD's cars can't be reached on the home network or over Bluetooth."
        >
          <BydConnect status={status} />
        </SettingsSection>
      )}
      {status?.connected && (
        <>
          {status.signed_out ? (
            <SettingsSection
              id="h-byd-signin"
              title="Sign in again"
              sub={`${status.error ?? "BYD no longer accepts the email and password."} The cars aren't read until it does.`}
            >
              <BydConnect status={status} />
            </SettingsSection>
          ) : (
            status.error && <p className="m-0 text-sm text-bad">Not updating: {status.error}</p>
          )}
          <SettingsSection
            id="h-byd-cars"
            title="Cars"
            sub="Each car is asked for its state every 10 minutes (every 5 while it's charging). A car out of mobile coverage keeps what it said last."
          >
            {status.vehicles.length > 0 ? (
              <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
                {status.vehicles.map((v) => (
                  <CarRow key={v.vin} v={v} />
                ))}
              </div>
            ) : (
              <p className="m-0 text-sm text-ink-muted">No cars on the account yet.</p>
            )}
          </SettingsSection>
          <Connection status={status} />
        </>
      )}
      <SettingsSection
        id="h-byd-about"
        title="It only reads the cars"
        sub="BYD's cloud can start a charge but can't stop one or set the current, so charging from spare solar isn't offered for a BYD: it would start the car with no way to slow it when a cloud passes. The dashboard never sends anything to the cars. BYD has no public API, so this reads the cloud the way the BYD app does, and could stop working if BYD changes it. It hasn't been tried on a real BYD yet: if anything looks off, an issue saying so gets it checked."
      >
        {null}
      </SettingsSection>
    </>
  );
}
