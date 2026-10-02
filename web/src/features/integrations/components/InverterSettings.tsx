import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import type { LiveStatus, Snapshot } from "~/features/common/live/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useNow } from "~/features/common/time/hooks";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { integrationsQuery, removeInverter, updateInverter } from "~/features/integrations/api";
import { ConnectInverter } from "~/features/integrations/components/ConnectInverter";
import type { ConnectedInverter } from "~/features/integrations/types";
import { deviceName } from "~/features/integrations/utils";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const METER = [
  { value: "behind", label: "House side of the meter" },
  { value: "outside", label: "Outside the meter" },
] as const;

/** A connected inverter: its live state from the stream, and removing it (or, for a second one, where it's wired). */
function InverterRow({
  device,
  live,
  snapshot,
  now,
  readOnly,
}: {
  device: ConnectedInverter;
  live: LiveStatus | undefined;
  snapshot: Snapshot | null;
  now: number;
  /** Following another server's collector: shown, not changed. */
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const hybrid = device.role === "hybrid";
  const pv2 = live?.system.pv2;
  const last = (hybrid ? live?.last_success : pv2?.last_success) ?? null;
  const error = hybrid ? live?.error : pv2?.error;
  const ok = !!last && now - last < (live?.poll_interval || 60) * 3;
  const reported = hybrid ? live?.system : pv2;
  const name = deviceName({
    brand: reported?.brand ?? device.brand,
    model: reported?.model ?? null,
    label: device.label,
  });
  const where = `${device.via ? `${device.via} at` : "At"} ${device.host}${device.port !== 502 ? `:${device.port}` : ""}`;
  const reading = hybrid
    ? last
      ? `last sync ${hhmm(last)}`
      : "waiting for its first reading"
    : ok && snapshot
      ? `${kW(snapshot.pv2_power)} now, ${kWh(snapshot.daily_pv2)} today`
      : last
        ? `last sync ${hhmm(last)} (it powers down after dark)`
        : "waiting for its first reading (it powers down after dark)";

  const changed = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const remove = useMutation({
    mutationFn: () => removeInverter(device.role),
    onSuccess: () => {
      toast(`Stopped reading the ${name}.`);
      changed();
    },
  });
  const meter = useMutation({
    mutationFn: (behind: boolean) => updateInverter(device.role, { behind_meter: behind }),
    onSuccess: () => {
      toast("Saved. It applies to new readings.");
      changed();
    },
  });
  const behind = meter.isPending ? meter.variables : device.behind_meter !== false;

  return (
    <IntegrationRow
      icon={hybrid ? "battery" : "sun"}
      name={name}
      on={ok}
      status={ok ? "Connected" : last ? "Not responding" : "Connecting"}
      detail={
        <>
          {hybrid ? "Main inverter, with the battery and meter" : "Second solar inverter"} · {where} · {reading}
          {!ok && error && <span className="mt-0.5 block text-xs text-ink-faint">{error}</span>}
        </>
      }
      action={
        readOnly ? undefined : confirming ? (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? "Removing…" : "Stop reading it"}
            </Button>
            <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )
      }
    >
      {(confirming || remove.isError || meter.isError || !hybrid) && (
        <div className="flex basis-full flex-col gap-2 pl-[60px] max-sm:pl-0">
          {confirming && (
            <HelpText>
              {hybrid
                ? "Readings stop until another inverter is connected. Recorded history stays."
                : "Its solar stops being counted. Recorded history stays."}
            </HelpText>
          )}
          {!hybrid && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Where it's wired</span>
              {readOnly ? (
                <span className="text-sm font-medium">{METER[behind ? 0 : 1].label}</span>
              ) : (
                <Segmented
                  label="Where the second inverter is wired"
                  options={[...METER]}
                  value={behind ? "behind" : "outside"}
                  onChange={(v) => meter.mutate(v === "behind")}
                  className="w-fit max-sm:w-full"
                  buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-3"
                />
              )}
              <HelpText>
                {behind
                  ? "The usual setup: the main inverter's meter sees its surplus as export, so its output is added to home use."
                  : "The main inverter's meter never sees it, so all of its output counts as exported."}
              </HelpText>
            </div>
          )}
          {(remove.isError || meter.isError) && (
            <HelpText tone="bad">{errorMessage(remove.error ?? meter.error)}</HelpText>
          )}
        </div>
      )}
    </IntegrationRow>
  );
}

/** Settings → Integrations: the inverters WattsMyPower reads, and connecting them. */
export function InverterSettings() {
  const { data, isPending, error } = useQuery(integrationsQuery);
  const live = useLive();
  const snapshot = useSnapshot();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const devices = data?.devices ?? [];
  const hasHybrid = devices.some((d) => d.role === "hybrid");
  const readOnly = data?.read_only ?? true;
  const connecting = !!data?.available && !readOnly && (open || !hasHybrid);

  return (
    <SettingsCard aria-labelledby="h-inverters">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle p-6">
        <SettingsTitle
          id="h-inverters"
          title="Inverters"
          sub="Read every minute over your home network, straight from the inverter"
        />
        {data?.available && !readOnly && hasHybrid && (
          <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Done" : "Connect an inverter"}
          </Button>
        )}
      </div>
      {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking what's connected…</div>}
      {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
      {data && !data.available && (
        <div className="border-b border-line-subtle px-6 py-5 text-sm leading-[22px] text-ink-muted last:border-b-0">
          {data.error}
        </div>
      )}
      {devices.map((d) => (
        <InverterRow key={d.role} device={d} live={live} snapshot={snapshot} now={now} readOnly={readOnly} />
      ))}
      {data?.available && readOnly && (
        <div className="px-6 py-4 text-[13px] leading-5 text-ink-muted">
          Read-only: this dashboard follows another server's collector (COLLECTOR_WRITES=false), so its inverters are
          changed from that server's own dashboard.
        </div>
      )}
      {data?.available && !readOnly && !hasHybrid && (
        <div className="flex flex-col gap-1 px-6 pt-5">
          <span className="text-[15px] font-semibold">Connect your inverter</span>
          <span className="text-[13px] text-ink-muted">
            {devices.length
              ? "The second inverter is connected, but nothing is recorded until the main one (with the battery and meter) is too."
              : "Nothing is recorded until your main inverter is connected. Find it on your network, or enter its address."}
          </span>
        </div>
      )}
      {connecting && data && <ConnectInverter overview={data} onConnected={() => setOpen(false)} />}
    </SettingsCard>
  );
}
