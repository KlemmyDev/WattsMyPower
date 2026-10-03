import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { InverterWiring } from "~/features/integrations/components/InverterWiring";
import { useInverters, useRemoveInverter } from "~/features/integrations/hooks";
import { deviceAddress, REMOVE_NOTE, ROLE_DETAIL, type InverterState } from "~/features/integrations/utils";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";

/** A connected inverter: its live state from the stream, and removing it (or, for a second one, where it's wired). */
function InverterRow({
  inverter: { device, name, hybrid, ok, error, status, on, reading },
  readOnly,
}: {
  inverter: InverterState;
  /** Following another server's collector: shown, not changed. */
  readOnly: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveInverter(device.role);
  const where = `${device.via ? `${device.via} at` : "At"} ${deviceAddress(device)}`;

  return (
    <IntegrationRow
      icon={hybrid ? "battery" : "sun"}
      name={name}
      on={on}
      status={status}
      detail={
        <>
          {ROLE_DETAIL[device.role]} · {where} · {reading}
          {!ok && error && <span className="mt-0.5 block text-xs text-ink-faint">{error}</span>}
        </>
      }
      action={
        readOnly ? undefined : confirming ? (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => remove.mutate(name)} disabled={remove.isPending}>
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
      {(confirming || remove.isError || !hybrid) && (
        <div className="flex basis-full flex-col gap-2 pl-[60px] max-sm:pl-0">
          {confirming && <HelpText>{REMOVE_NOTE[device.role]}</HelpText>}
          {!hybrid && <InverterWiring device={device} readOnly={readOnly} />}
          {remove.isError && <HelpText tone="bad">{errorMessage(remove.error)}</HelpText>}
        </div>
      )}
    </IntegrationRow>
  );
}

/** Read-only: this dashboard follows another server's collector, so its inverters are changed there. */
export function ReadOnlyNote() {
  return (
    <div className="px-6 py-4 text-[13px] leading-5 text-ink-muted">
      Read-only: this dashboard follows another server's collector (COLLECTOR_WRITES=false), so its inverters are
      changed from that server's own dashboard.
    </div>
  );
}

/**
 * The connected inverters, each with its live state and controls, or why they can't be shown. The body of
 * the set-up guide's first step.
 */
export function ConnectedInverters() {
  const { data, isPending, error, inverters } = useInverters();
  const readOnly = data?.read_only ?? true;

  return (
    <>
      {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking what's connected…</div>}
      {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
      {data && !data.available && (
        <div className="border-b border-line-subtle px-6 py-5 text-sm leading-[22px] text-ink-muted last:border-b-0">
          {data.error}
        </div>
      )}
      {inverters.map((i) => (
        <InverterRow key={i.device.role} inverter={i} readOnly={readOnly} />
      ))}
      {data?.available && readOnly && <ReadOnlyNote />}
    </>
  );
}
