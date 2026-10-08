import { errorMessage } from "~/features/common/api/utils";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { useInverters } from "~/features/integrations/hooks";
import { deviceAddress, ROLE_DETAIL } from "~/features/integrations/utils";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Manage → Integrations → Sungrow: the inverters WattsMyPower reads, each opening to its own page, the
 * way to connect another, and importing history from iSolarCloud.
 */
export function SungrowSettings() {
  const { data, isPending, error, inverters } = useInverters();
  const hasHybrid = inverters.some((i) => i.hybrid);
  const readOnly = data?.read_only ?? true;
  const canConnect = !!data?.available && !readOnly;

  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-sungrow"
        title="Sungrow"
        sub="Your inverters, read every minute over your home network, straight from the inverter"
      />
      <SettingsCard aria-label="Inverters">
        {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking what's connected…</div>}
        {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
        {data && !data.available && (
          <div className="border-b border-line-subtle px-6 py-5 text-sm leading-[22px] text-ink-muted last:border-b-0">
            {data.error}
          </div>
        )}
        {inverters.map(({ device, name, hybrid, status, on, reading }) => (
          <IntegrationLink
            key={device.role}
            to="/integrations/sungrow/$role"
            params={{ role: device.role }}
            icon={hybrid ? "battery" : "sun"}
            name={name}
            status={status}
            on={on}
            detail={
              <>
                {ROLE_DETAIL[device.role]}
                <span className="block text-xs text-ink-faint tabular-nums">
                  At {deviceAddress(device)} · {reading}
                </span>
              </>
            }
          />
        ))}
        {canConnect && hasHybrid && (
          <IntegrationLink
            to="/integrations/sungrow/connect"
            icon="plus"
            name="Add an inverter"
            detail="Find inverters on your network, or enter an address"
          />
        )}
        {canConnect && !hasHybrid && (
          <div className="flex flex-col items-start gap-4 px-6 py-6">
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold">Connect your inverter</span>
              <span className="text-[13px] text-ink-muted">
                {inverters.length
                  ? "The second inverter is connected, but nothing is recorded until the main one (with the battery and meter) is too."
                  : "Nothing is recorded until your main inverter is connected. Find it on your network, or enter its address."}
              </span>
            </div>
            <ButtonLink to="/integrations/sungrow/connect">Find your inverter</ButtonLink>
          </div>
        )}
        {data?.available && readOnly && <ReadOnlyNote />}
      </SettingsCard>
      <SettingsCard aria-label="History">
        <IntegrationLink
          to="/integrations/sungrow/import"
          icon="upload"
          name="Import history from iSolarCloud"
          detail="Bring in the days before WattsMyPower was set up, or fill gaps, from iSolarCloud's 5-minute exports"
        />
      </SettingsCard>
    </>
  );
}
