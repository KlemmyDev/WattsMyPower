import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { carsQuery } from "~/features/car/api";
import { carName } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { HelpText, Select } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
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

/** How the cars are reached, in words (this server's key, or Tessie's token) and when they were last read, with
 * disconnecting on the right. */
function Connection({ status }: { status: TeslaStatus }) {
  const { disconnect } = useEvChange();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const bt = status.provider === "bluetooth";
  return (
    <SettingsSection
      id="h-tesla-connection"
      title={`Connected ${bt ? "over Bluetooth" : "through Tessie"}`}
      sub={
        <>
          {bt
            ? `This server's key ${status.bluetooth.key ?? ""}: ${status.bluetooth.role === "driver" ? "a driver's, so it can wake the car" : "charging only, so it can't wake the car"}.`
            : `With the access token ${status.token}.`}{" "}
          {status.reading ? "Reading now…" : status.read_at ? `Last read at ${hhmm(status.read_at)}.` : ""}
        </>
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
        <HelpText>
          {bt
            ? "The dashboard stops reading the cars and charging from solar. The cars keep this server's key (remove it in the car, under Controls → Locks, if you like), so pairing again needs no tap."
            : "The token is removed from this server and the dashboard stops charging from solar."}{" "}
          Your cars and their levels stay.
        </HelpText>
      )}
      {disconnect.isError && <HelpText tone="bad">{errorMessage(disconnect.error)}</HelpText>}
    </SettingsSection>
  );
}

/** A Tesla: which car's details it charges with, opening them, and (over Bluetooth) leaving it out. */
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
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">
          {v.name ?? v.model ?? "Tesla"}
          {v.state?.soc != null && (
            <span className="font-normal text-ink-muted tabular-nums"> · {Math.round(v.state.soc)}%</span>
          )}
        </span>
        <span className="font-mono text-xs text-ink-muted">
          {v.model && <span className="font-sans">{[v.year, v.model].filter(Boolean).join(" ")} · </span>}
          {v.vin}
          <span className="font-sans">
            {" "}
            · charging: {MODE_LABEL[v.control.mode].toLowerCase()}
            {reach && ` · ${reach}`}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`The details ${v.name ?? "this Tesla"} charges with`}
          className="w-48"
          value={v.car ?? ""}
          disabled={configure.isPending}
          onChange={(e) => configure.mutate({ vin: v.vin, car: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{v.model ? `${v.model} figures` : "Its model's figures"}</option>
          {cars?.map((c) => (
            <option key={c.id} value={c.id}>
              {carName(c)}&apos;s details
            </option>
          ))}
        </Select>
        {v.car != null && (
          <ButtonLink
            to="/integrations/ev/tesla/car/$carId"
            params={{ carId: String(v.car) }}
            size="sm"
            variant="outline"
          >
            Details
          </ButtonLink>
        )}
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

/** Cars added by hand before each Tesla brought its own, and not tied to one: shown so they can be checked or removed. */
function HandAdded({ status }: { status?: TeslaStatus }) {
  const { data: cars } = useQuery(carsQuery);
  const tied = new Set((status?.vehicles ?? []).map((v) => v.car));
  const loose = (cars ?? []).filter((c) => !tied.has(c.id));
  if (!loose.length) return null;
  return (
    <SettingsSection
      id="h-tesla-other-cars"
      title="Cars added by hand"
      sub="From before cars came from a connected Tesla. The Overview still draws them; remove one you don't need."
    >
      <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
        {loose.map((c) => (
          <IntegrationLink
            key={c.id}
            to="/integrations/ev/tesla/car/$carId"
            params={{ carId: String(c.id) }}
            icon="car"
            name={carName(c)}
            detail={`${c.car.car_battery_kwh} kWh · up to ${c.car.car_amps} A`}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

/**
 * Manage → Integrations → Electric vehicles → Tesla: how the cars are reached (over this server's Bluetooth, or
 * through Tessie; the dashboard does the same with them either way), each car and the details it charges with, pairing
 * another over Bluetooth, and switching from one way to the other.
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
        back={<BackLink to="/integrations/ev">Electric vehicles</BackLink>}
        id="h-tesla"
        title="Tesla"
        sub="See each car's charge, and charge it from spare solar on the EV page. Over this server's Bluetooth or through Tessie: the dashboard does the same either way."
      />
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking the connection…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {status && !provider && (
        <SettingsSection
          id="h-tesla-connect"
          title="Connect your Tesla"
          sub="Choose how the dashboard reaches it. You can switch later; each car keeps how it charges."
        >
          <TeslaConnect />
        </SettingsSection>
      )}
      {status && provider && (
        <>
          {status.error && <p className="m-0 text-sm text-bad">Not updating: {status.error}</p>}
          <SettingsSection
            id="h-tesla-cars"
            title="Cars"
            sub="Each charges with its own details (phases, the lowest and highest current) once it's charged at home and reported them, or its model's until then."
            aside={
              provider === "bluetooth" &&
              !adding && (
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                  Pair another car
                </Button>
              )
            }
          >
            {status.vehicles.length > 0 && (
              <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
                {status.vehicles.map((v) => (
                  <VehicleRow key={v.vin} v={v} provider={provider} />
                ))}
              </div>
            )}
            {provider === "bluetooth" && adding && (
              <div className="flex flex-col gap-3 rounded-2xl bg-canvas/60 p-5 light:bg-canvas">
                <span className="text-sm font-medium">Pair another car</span>
                <BluetoothPair onPaired={() => setAdding(false)} />
                <Button variant="muted-link" size="sm" className="self-start" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </SettingsSection>
          <Connection status={status} />
        </>
      )}
      {provider === "bluetooth" && status?.bluetooth.role === "charging_manager" && (
        <SettingsSection
          id="h-tesla-wake"
          title="Let the dashboard wake the car"
          sub="This server's key is charging only, so it can't wake the car: once it's asleep, charging from solar waits until it wakes. Pair it again as a driver, as your phone key is, and the dashboard can wake it."
          aside={
            !asDriver && (
              <Button variant="outline" size="sm" onClick={() => setAsDriver(true)}>
                Pair again as a driver
              </Button>
            )
          }
        >
          {asDriver && (
            <div className="flex flex-col gap-3">
              <BluetoothPair role="driver" vin={status.vehicles[0]?.vin} onPaired={() => setAsDriver(false)} />
              <Button variant="muted-link" size="sm" className="self-start" onClick={() => setAsDriver(false)}>
                Cancel
              </Button>
            </div>
          )}
        </SettingsSection>
      )}
      {provider && (
        <div className="grid gap-5 xl:grid-cols-2">
          {provider === "bluetooth" && (
            <SettingsSection
              id="h-tesla-slots"
              title="A Tesla takes only a few Bluetooth connections"
              sub="About three at once: each phone or watch with its key holds one while it's near the car, and with them all taken the car won't take the dashboard's. So while the car's plugged in at home by day (or charging), the dashboard keeps its connection open after each read, to keep its place; at night, and once the car's unplugged, it lets go so the car can sleep. When the dashboard can't get in, the EV page says so and tries again every few minutes. Keys you don't use are best removed in the car, under Controls → Locks."
            >
              {null}
            </SettingsSection>
          )}
          <SettingsSection
            id="h-tesla-switch"
            title={`Use ${PROVIDER_LABEL[OTHER[provider]]} instead`}
            sub={SWITCH_ABOUT[OTHER[provider]]}
            aside={
              !switching && (
                <Button variant="outline" size="sm" onClick={() => setSwitching(true)}>
                  Switch to {PROVIDER_LABEL[OTHER[provider]]}
                </Button>
              )
            }
          >
            {switching && <TeslaConnect only={OTHER[provider]} onConnected={() => setSwitching(false)} />}
          </SettingsSection>
        </div>
      )}
      <HandAdded status={status} />
    </>
  );
}
