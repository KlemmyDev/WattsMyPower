import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { longDate } from "~/features/common/formatting/utils/date";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { SettingRow } from "~/features/common/ui/components/DataRow";
import { HelpText } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { InverterWiring } from "~/features/integrations/components/InverterWiring";
import { useInverters, useRemoveInverter } from "~/features/integrations/hooks";
import {
  asRole,
  deviceAddress,
  REMOVE_NOTE,
  ROLE_DETAIL,
  ROLE_NAME,
  type InverterState,
} from "~/features/integrations/utils";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const back = <BackLink to="/integrations/inverters">Sungrow</BackLink>;

/** Stop reading it, once confirmed; then back to the list. */
function RemoveInverter({ inverter: { device, name } }: { inverter: InverterState }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveInverter(device.role, () => navigate({ to: "/integrations/inverters" }));

  return (
    <SettingsCard aria-label="Remove" className="flex-row flex-wrap items-center gap-x-4 gap-y-3 px-6 py-5">
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">Stop reading this inverter</span>
        <span className="text-[13px] text-ink-muted">{REMOVE_NOTE[device.role]}</span>
        {remove.isError && <HelpText tone="bad">{errorMessage(remove.error)}</HelpText>}
      </div>
      {confirming ? (
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
      )}
    </SettingsCard>
  );
}

/** Manage → Integrations → Inverters → one inverter: what it is, how it's doing, where it's wired, and removing it. */
export function InverterDetail({ role }: { role: string }) {
  const { data, isPending, isFetching, error, inverters } = useInverters();
  const known = asRole(role);
  const inverter = inverters.find((i) => i.device.role === known);
  const readOnly = data?.read_only ?? true;

  if (!inverter) {
    // Just connected, and the list is still catching up: wait for it rather than say it isn't there.
    const waiting = isPending || (!!known && isFetching);
    return (
      <>
        <SubPageHeader
          back={back}
          id="h-inverter"
          title={known ? `Your ${ROLE_NAME[known]}` : "Inverter"}
          sub={
            waiting
              ? "Checking what's connected…"
              : error
                ? errorMessage(error)
                : known
                  ? `No ${ROLE_NAME[known]} is connected.`
                  : "There's no inverter here."
          }
        />
        {!waiting && (
          <ButtonLink to="/integrations/inverters" variant="outline" className="self-start">
            See your inverters
          </ButtonLink>
        )}
      </>
    );
  }

  const { device, name, ok, error: problem, status, on, reading, hybrid } = inverter;
  const rows: [string, string | null][] = [
    ["Type", [device.brand, device.label].filter(Boolean).join(" ") || null],
    ["Address", deviceAddress(device)],
    ["Connected through", device.via],
    ["Serial number", device.serial],
    ["Size", device.nominal_kw ? `${device.nominal_kw} kW` : null],
    ["Added", longDate.format(new Date(device.added_at * 1000))],
  ];

  return (
    <>
      <SubPageHeader back={back} id="h-inverter" title={name} sub={ROLE_DETAIL[device.role]} />
      <SettingsCard aria-labelledby="h-inverter">
        <div className="flex flex-col gap-1.5 border-b border-line-subtle px-6 py-5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <Pill tone={on ? "ok" : "neutral"}>{status}</Pill>
            <span className="text-ink-muted">{reading.charAt(0).toUpperCase() + reading.slice(1)}</span>
          </div>
          {!ok && problem && <span className="text-xs text-ink-faint">{problem}</span>}
        </div>
        <div className={readOnly ? undefined : "[&>:last-child]:border-b-0"}>
          {rows.map(
            ([label, value]) =>
              value && (
                <SettingRow key={label} label={label}>
                  <span className="break-words">{value}</span>
                </SettingRow>
              ),
          )}
        </div>
        {readOnly && <ReadOnlyNote />}
      </SettingsCard>
      {!hybrid && (
        <SettingsCard padded aria-label="Where it's wired" className="max-sm:p-5">
          <InverterWiring device={device} readOnly={readOnly} />
        </SettingsCard>
      )}
      {!readOnly && <RemoveInverter inverter={inverter} />}
    </>
  );
}
