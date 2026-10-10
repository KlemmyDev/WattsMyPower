import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { carsQuery } from "~/features/car/api";
import { carName } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { HelpText, Select } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { teslaQuery } from "~/features/ev/api";
import { BluetoothPair } from "~/features/ev/components/BluetoothPair";
import { TeslaConnect } from "~/features/ev/components/TeslaConnect";
import { useEvChange } from "~/features/ev/hooks";
import type { EvVehicle, TeslaProvider, TeslaStatus } from "~/features/ev/types";
import { MODE_LABEL, PROVIDER_LABEL } from "~/features/ev/utils";

const OTHER: Record<TeslaProvider, TeslaProvider> = { bluetooth: "tessie", tessie: "bluetooth" };

const SWITCH_ABOUT: Record<TeslaProvider, string> = {
  bluetooth:
    "Reach the car over this server's Bluetooth instead, with nothing going through the cloud. Pair it here; once it's paired, Tessie's token is removed.",
  tessie:
    "Reach the car through Tessie instead, from anywhere. Once Tessie's connected, the cars it has replace the ones paired here.",
};

/** How the cars are reached, in a row: Tessie's token, or this server's Bluetooth key, and disconnecting. */
function ConnectionRow({ status }: { status: TeslaStatus }) {
  const { disconnect } = useEvChange();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const bt = status.provider === "bluetooth";
  return (
    <IntegrationRow
      icon={bt ? "bluetooth" : "bolt"}
      name={bt ? "Bluetooth" : "Tessie"}
      on={!status.error}
      status={status.error ? "Not updating" : "Connected"}
      detail={
        <>
          {bt
            ? `This server's key ${status.bluetooth.key ?? ""}, ${status.bluetooth.role === "driver" ? "a driver's: it can wake the car" : "charging only: it can't wake the car"}`
            : `Access token ${status.token}`}
          {status.read_at && ` · read ${hhmm(status.read_at)}`}
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
                    toast(bt ? "The Teslas are disconnected." : "Disconnected from Tessie.");
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
      {confirming && (
        <div className="basis-full pl-[60px] max-sm:pl-0">
          <HelpText>
            {bt
              ? "The dashboard stops reading the cars and charging from solar. The cars keep this server's key (remove it in the car, under Controls → Locks, if you like), so pairing again needs no tap."
              : "The token is removed from this server and the dashboard stops charging from solar."}{" "}
            Your cars and their levels stay.
          </HelpText>
        </div>
      )}
    </IntegrationRow>
  );
}

/** A Tesla: which dashboard car it is, and (over Bluetooth) leaving it out. */
function VehicleRow({ v, provider }: { v: EvVehicle; provider: TeslaProvider }) {
  const { data: cars } = useQuery(carsQuery);
  const { configure, remove } = useEvChange();
  const [confirming, setConfirming] = useState(false);
  const reach =
    provider === "bluetooth" && v.state
      ? v.state.in_range
        ? v.linked
          ? "connected, the link held open"
          : "in range"
        : "not heard"
      : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle px-6 py-5 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{v.name ?? "Tesla"}</span>
        <span className="font-mono text-xs text-ink-muted">
          {v.vin}
          <span className="font-sans">
            {" "}
            · charging: {MODE_LABEL[v.control.mode].toLowerCase()}
            {reach && ` · ${reach}`}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label={`The dashboard car ${v.name ?? "this Tesla"} is`}
          className="w-48"
          value={v.car ?? ""}
          disabled={configure.isPending}
          onChange={(e) => configure.mutate({ vin: v.vin, car: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Its model's figures</option>
          {cars?.map((c) => (
            <option key={c.id} value={c.id}>
              {carName(c)}
            </option>
          ))}
        </Select>
        <ButtonLink to="/ev" size="sm" variant="outline">
          Open
        </ButtonLink>
        {provider === "bluetooth" &&
          (confirming ? (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate(v.vin, { onSuccess: () => setConfirming(false) })}
              >
                {remove.isPending ? "Removing…" : "Remove it"}
              </Button>
              <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="muted-link" size="sm" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          ))}
      </div>
      {confirming && (
        <HelpText className="basis-full">
          The dashboard stops reading this car and charging it from solar. To add it back, pair it again here, sitting
          in the car with your key card in case it asks for a tap.
        </HelpText>
      )}
      {(configure.isError || remove.isError) && (
        <HelpText tone="bad" className="basis-full">
          {errorMessage(configure.error ?? remove.error)}
        </HelpText>
      )}
    </div>
  );
}

/**
 * Manage → Integrations → Tesla: how the cars are reached (over this server's Bluetooth, or through Tessie; the
 * dashboard does the same with them either way), which dashboard car each Tesla is, pairing another over Bluetooth,
 * and switching from one way to the other.
 */
export function TeslaSettings() {
  const { data: status, isPending, error } = useQuery(teslaQuery);
  const [adding, setAdding] = useState(false);
  const [asDriver, setAsDriver] = useState(false);
  const [switching, setSwitching] = useState(false);
  const provider = status?.connected ? status.provider : null;

  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-tesla"
        title="Tesla"
        sub="See each car's charge, and charge it from spare solar on the EV page. Over this server's Bluetooth or through Tessie: the dashboard does the same either way."
      />
      <SettingsCard aria-labelledby="h-tesla">
        {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking the connection…</div>}
        {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
        {status && !provider && <TeslaConnect className="px-6 py-5" />}
        {status && provider && (
          <>
            <ConnectionRow status={status} />
            {status.vehicles.map((v) => (
              <VehicleRow key={v.vin} v={v} provider={provider} />
            ))}
            {provider === "bluetooth" &&
              (adding ? (
                <div className="flex flex-col gap-3 px-6 py-5">
                  <span className="text-sm font-medium">Pair another car</span>
                  <BluetoothPair onPaired={() => setAdding(false)} />
                  <Button variant="muted-link" size="sm" className="self-start" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="px-6 py-4">
                  <Button variant="link" size="sm" onClick={() => setAdding(true)}>
                    Pair another car
                  </Button>
                </div>
              ))}
          </>
        )}
      </SettingsCard>
      {provider === "bluetooth" && status?.bluetooth.role === "charging_manager" && (
        <SettingsCard padded aria-labelledby="h-tesla-wake">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SettingsTitle
              id="h-tesla-wake"
              title="Let the dashboard wake the car"
              sub="This server's key is charging only, so it can't wake the car: once it's asleep, charging from solar waits until it wakes. Pair it again as a driver, as your phone key is, and the dashboard can wake it."
            />
            {!asDriver && (
              <Button variant="outline" size="sm" onClick={() => setAsDriver(true)}>
                Pair again as a driver
              </Button>
            )}
          </div>
          {asDriver && (
            <div className="mt-4 flex flex-col gap-3">
              <BluetoothPair role="driver" vin={status.vehicles[0]?.vin} onPaired={() => setAsDriver(false)} />
              <Button variant="muted-link" size="sm" className="self-start" onClick={() => setAsDriver(false)}>
                Cancel
              </Button>
            </div>
          )}
        </SettingsCard>
      )}
      {provider === "bluetooth" && (
        <SettingsCard padded aria-labelledby="h-tesla-slots">
          <SettingsTitle
            id="h-tesla-slots"
            title="A Tesla takes only a few Bluetooth connections"
            sub="About three at once: each phone or watch with its key holds one while it's near the car, and with them all taken the car won't take the dashboard's. So while the car's plugged in at home by day (or charging), the dashboard keeps its connection open after each read, to keep its place; at night, and once the car's unplugged, it lets go so the car can sleep. When the dashboard can't get in, the EV page says so and tries again every few minutes. Keys you don't use are best removed in the car, under Controls → Locks."
          />
        </SettingsCard>
      )}
      {provider && (
        <SettingsCard padded aria-labelledby="h-tesla-switch">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SettingsTitle
              id="h-tesla-switch"
              title={`Use ${PROVIDER_LABEL[OTHER[provider]]} instead`}
              sub={SWITCH_ABOUT[OTHER[provider]]}
            />
            {!switching && (
              <Button variant="outline" size="sm" onClick={() => setSwitching(true)}>
                Switch to {PROVIDER_LABEL[OTHER[provider]]}
              </Button>
            )}
          </div>
          {switching && <TeslaConnect only={OTHER[provider]} onConnected={() => setSwitching(false)} />}
        </SettingsCard>
      )}
      <HelpText className="text-[13px]">
        Each Tesla keeps how it charges when you switch. Its model's phases and lowest and highest current are used
        until the car has charged at home and reported its own, or a car's from Integrations → Electric vehicle if you
        tie it to one.
      </HelpText>
    </>
  );
}
