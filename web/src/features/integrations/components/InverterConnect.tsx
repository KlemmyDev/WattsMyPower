import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { integrationsQuery } from "~/features/integrations/api";
import { ConnectInverter } from "~/features/integrations/components/ConnectInverter";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { brandSlug } from "~/features/integrations/utils";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Manage → Integrations → Inverters → connecting an inverter, then on to its page. `brand` comes first in the form. */
export function InverterConnect({ brand }: { brand?: string }) {
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery(integrationsQuery);
  const hasHybrid = !!data?.devices.some((d) => d.role === "hybrid");

  return (
    <>
      <SubPageHeader
        back={
          brand ? (
            <BackLink to="/integrations/inverters/$brand" params={{ brand: brandSlug(brand) }}>
              {data?.kinds.find((k) => brandSlug(k.brand) === brandSlug(brand))?.brand ?? "Inverters"}
            </BackLink>
          ) : (
            <BackLink to="/integrations/inverters">Inverters</BackLink>
          )
        }
        id="h-connect"
        title={hasHybrid ? "Add an inverter" : "Connect your inverter"}
        sub={
          hasHybrid
            ? "A second solar inverter, or a new one to replace yours. Find it with a quick scan, or enter its address."
            : "Nothing is recorded until your main inverter (with the battery and meter) is connected. Find it with a quick scan, or enter its address."
        }
      />
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking what's connected…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {data && !data.available && <p className="m-0 text-sm leading-[22px] text-ink-muted">{data.error}</p>}
      {data?.available && data.read_only && (
        <SettingsSection id="h-read-only" title="Read only">
          <ReadOnlyNote />
        </SettingsSection>
      )}
      {data?.available && !data.read_only && (
        <ConnectInverter
          overview={data}
          brand={brand}
          sections
          onConnected={(device) =>
            navigate({
              to: "/integrations/inverters/$brand/$role",
              params: { brand: brandSlug(device.brand), role: device.role },
            })
          }
        />
      )}
    </>
  );
}
