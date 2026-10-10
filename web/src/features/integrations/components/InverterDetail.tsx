import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { longDate } from "~/features/common/formatting/utils/date";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { cn } from "~/features/common/ui/utils";
import { ConfirmAction } from "~/features/integrations/components/ConfirmAction";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { InverterWiring } from "~/features/integrations/components/InverterWiring";
import { ReachTag, UntestedTag } from "~/features/integrations/components/ReachTag";
import { useInverters, useRemoveInverter } from "~/features/integrations/hooks";
import { asRole, brandSlug, deviceAddress, REMOVE_NOTE, ROLE_DETAIL, ROLE_NAME } from "~/features/integrations/utils";
import { OptionList, SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Manage → Integrations → Inverters → a brand → one inverter: how it's doing in a line at the top (and what went wrong,
 * if anything), what it reported about itself, where it's wired (a second inverter), and removing it. Reached under
 * another brand's address (the inverter in that role was swapped for another make), it moves to its own.
 */
export function InverterDetail({ brand, role }: { brand: string; role: string }) {
  const navigate = useNavigate();
  const { data, isPending, isFetching, error, inverters } = useInverters();
  const known = asRole(role);
  const inverter = inverters.find((i) => i.device.role === known);
  const readOnly = data?.read_only ?? true;
  const remove = useRemoveInverter(known ?? "hybrid", () =>
    navigate({ to: "/integrations/inverters/$brand", params: { brand } }),
  );
  const own = inverter ? brandSlug(inverter.device.brand) : brand;
  useEffect(() => {
    if (own !== brand && known)
      void navigate({ to: "/integrations/inverters/$brand/$role", params: { brand: own, role: known }, replace: true });
  }, [own, brand, known, navigate]);
  const back = (
    <BackLink to="/integrations/inverters/$brand" params={{ brand }}>
      {inverter?.device.brand ?? "Inverters"}
    </BackLink>
  );

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
    ["Model", device.model],
    ["Address", deviceAddress(device)],
    ["Connected through", device.via],
    ["Serial number", device.serial],
    ["Size", device.nominal_kw ? `${device.nominal_kw} kW` : null],
    ["Added", longDate.format(new Date(device.added_at * 1000))],
  ];

  return (
    <>
      <SubPageHeader back={back} id="h-inverter" title={name} sub={ROLE_DETAIL[device.role]} />
      <p className={cn("m-0 text-sm", on ? "text-ink-muted" : "text-warn")}>
        {status}: {reading}.
      </p>
      {!ok && problem && <p className="m-0 text-sm text-bad">{problem}</p>}
      <div className={hybrid ? "flex flex-col gap-5" : "grid gap-5 xl:grid-cols-2"}>
        <SettingsSection
          id="h-inverter-about"
          title="About it"
          sub="What it reported about itself, and how it's reached."
        >
          <OptionList>
            {rows.map(
              ([label, value]) =>
                value && (
                  <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                    <span className="flex-none text-ink-muted">{label}</span>
                    <span className="min-w-0 text-right break-words text-ink tabular-nums">{value}</span>
                  </div>
                ),
            )}
          </OptionList>
          <span className="flex flex-wrap gap-3">
            <ReachTag reach="local" />
            {device.verified === false && <UntestedTag />}
          </span>
          {readOnly && <ReadOnlyNote />}
        </SettingsSection>
        {!hybrid && (
          <SettingsSection
            id="h-inverter-wiring"
            title="Where it's wired"
            sub="Which side of the main inverter's meter it connects on decides how its output is counted."
          >
            <InverterWiring device={device} readOnly={readOnly} bare />
          </SettingsSection>
        )}
      </div>
      {!readOnly && (
        <SettingsSection
          id="h-inverter-remove"
          title="Stop reading it"
          sub="Takes it off WattsMyPower. It can be connected again any time."
          aside={
            <ConfirmAction
              label="Stop reading it"
              doing="Removing…"
              note={REMOVE_NOTE[device.role]}
              pending={remove.isPending}
              error={remove.error}
              run={() => remove.mutate(name)}
            />
          }
        >
          {null}
        </SettingsSection>
      )}
    </>
  );
}
