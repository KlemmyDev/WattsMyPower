import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { ReachTag, UntestedTag } from "~/features/integrations/components/ReachTag";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { bluelinkQuery } from "~/features/ev/api";
import { BluelinkConnect } from "~/features/ev/components/BluelinkConnect";
import { NextRead } from "~/features/ev/components/NextRead";
import { useBluelinkChange } from "~/features/ev/hooks";
import type { BluelinkCar, BluelinkStatus } from "~/features/ev/types";
import { MODE_LABEL, STATUS_LABEL } from "~/features/ev/utils";

/** A car: its name and charge, which it is, what it's doing and how it charges, and opening it on the EV page. */
function CarRow({ v }: { v: BluelinkCar }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">
          {v.name ?? v.model ?? v.make}
          {v.state?.soc != null && (
            <span className="font-normal text-ink-muted tabular-nums"> · {Math.round(v.state.soc)}%</span>
          )}
        </span>
        <span className="font-mono text-xs text-ink-muted">
          <span className="font-sans">{[v.year, v.make, v.model].filter(Boolean).join(" ")} · </span>
          {v.vin}
          <span className="font-sans">
            {" "}
            · {STATUS_LABEL[v.status].toLowerCase()} · {MODE_LABEL[v.control.mode].toLowerCase()}
            {v.ccs2 && !v.can_command ? " · needs the PIN to charge from solar" : ""}
          </span>
        </span>
      </div>
      <ButtonLink to="/ev/$vin" params={{ vin: v.vin }} size="sm" variant="outline">
        Open
      </ButtonLink>
    </div>
  );
}

/** The app's PIN: set (or changed) here, never shown. Newer cars need it to start and stop charging. */
function PinForm({ status }: { status: BluelinkStatus }) {
  const { pin: save } = useBluelinkChange();
  const toast = useToast();
  const [pin, setPin] = useState("");
  const ok = /^\d{4}$/.test(pin);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok)
      save.mutate(pin, {
        onSuccess: () => {
          setPin("");
          toast("PIN saved.");
        },
      });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field label={status.pin ? "Change the PIN" : "App PIN"} className="w-40">
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={!ok || save.isPending}>
        {save.isPending ? "Saving…" : "Save PIN"}
      </Button>
      {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
    </form>
  );
}

/** The account (its email, partly hidden) and when it was read, with reading it now and disconnecting. */
function Connection({ status }: { status: BluelinkStatus }) {
  const { refresh, disconnect } = useBluelinkChange();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const region = status.regions.find((r) => r.code === status.region)?.name;
  const app = status.brands.find((b) => b.code === status.brand)?.app ?? "Bluelink";
  return (
    <SettingsSection
      id="h-bl-connection"
      title={`Connected through ${app}`}
      sub={
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>
            As {status.account}
            {region ? ` (${region})` : ""}, {status.pin ? "with the app's PIN" : "without a PIN"}.{" "}
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
                    toast(`Disconnected from ${app}.`);
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
              onClick={() => refresh.mutate(undefined)}
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
          The email, password and PIN are removed from this server, and the dashboard stops reading and charging the
          cars. Nothing changes in the cars or the {app} app.
        </HelpText>
      )}
      {(refresh.isError || disconnect.isError) && (
        <HelpText tone="bad">{errorMessage(refresh.error ?? disconnect.error)}</HelpText>
      )}
      <PinForm status={status} />
    </SettingsSection>
  );
}

/**
 * Manage → Integrations → Electric vehicles → Hyundai and Kia: signing in to Hyundai's Bluelink or Kia Connect (the
 * only ways to reach these cars: there's no local one), each car on the account, and what the dashboard can and can't
 * do with them (charge them from spare solar by starting and stopping, as their speed can't be set).
 */
export function BluelinkSettings() {
  const { data: status, isPending, error } = useQuery(bluelinkQuery);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations/ev">Electric vehicles</BackLink>}
        id="h-bl"
        title="Hyundai and Kia"
        sub="See each car's charge on the EV page, and charge it from spare solar, as a Tesla is."
      />
      <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ReachTag reach="cloud" />
        <UntestedTag />
      </div>
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking the connection…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {status && !status.connected && (
        <SettingsSection
          id="h-bl-connect"
          title="Connect your Hyundai or Kia"
          sub="Ioniq 5, Ioniq 6, Kona Electric, EV6, EV9, EV5, Niro EV and the other electric cars and plug-in hybrids in the Bluelink or Kia Connect app. The dashboard reaches them through the maker's cloud, as the app does: these cars can't be reached on the home network or over Bluetooth."
        >
          <BluelinkConnect status={status} />
        </SettingsSection>
      )}
      {status?.connected && (
        <>
          {status.signed_out ? (
            <SettingsSection
              id="h-bl-signin"
              title="Sign in again"
              sub={`${status.error ?? "The email and password are no longer accepted."} The cars aren't read until they are.`}
            >
              <BluelinkConnect status={status} />
            </SettingsSection>
          ) : (
            status.error && <p className="m-0 text-sm text-bad">Not updating: {status.error}</p>
          )}
          <SettingsSection
            id="h-bl-cars"
            title="Cars"
            sub="Each car's state is read from the cloud every 15 minutes (every 5 while it could charge from solar). How it charges is set on its EV page."
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
        id="h-bl-about"
        title="What it can do"
        sub="It reads each car's charge, range, plug and charging, time to full, charge limit and where it's parked, and on its EV page it can charge it from spare solar: start it once there's been enough spare sun for its charger for a while, stop it once there hasn't, with the same choices and timing as a Tesla. Hyundai's and Kia's clouds can start and stop a charge and set the charge limit (in tens of percent), but can't set how fast it charges, so the car always charges at what its charger gives: choose your charger on its EV page, as solar charging only starts once that much is spare."
      >
        {null}
      </SettingsSection>
      <SettingsSection
        id="h-bl-limits"
        title="Worth knowing"
        sub="Everything goes through Hyundai's or Kia's cloud, as their apps do: there's no public API, so it could stop working if they change it, and a passing outage there pauses solar charging. The cloud only knows what the car last sent it, so the dashboard asks the car itself now and then by day (it wakes the car's modem and draws a little on its 12 V battery: choose how often, or never, on the car's EV page). Too many requests in a day and the cloud refuses more for a while. Genesis isn't supported yet: in Australia it has its own app and servers. It hasn't been tried on a real Hyundai or Kia yet: if anything looks off, an issue saying so gets it checked."
      >
        {null}
      </SettingsSection>
    </>
  );
}
