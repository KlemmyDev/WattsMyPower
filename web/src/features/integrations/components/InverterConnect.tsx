import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { Notice } from "~/features/common/ui/components/Notice";
import { integrationsQuery } from "~/features/integrations/api";
import { ConnectInverter } from "~/features/integrations/components/ConnectInverter";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { BRAND_ABOUT, brandSlug } from "~/features/integrations/utils";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { PageLoading, PageProblem } from "~/features/settings/components/PageStatus";

/**
 * Manage → Integrations → Inverters → a brand → connecting one of that brand's inverters (scanning for it, or by its
 * address), then on to its page. Each brand has its own: no choosing the brand here.
 */
export function InverterConnect({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery(integrationsQuery);
  const brand = data?.kinds.find((k) => brandSlug(k.brand) === slug)?.brand;
  const hasHybrid = !!data?.devices.some((d) => d.role === "hybrid");
  const setup = brand && BRAND_ABOUT[brand]?.setup;

  return (
    <>
      <SubPageHeader
        back={
          <BackLink to="/integrations/inverters/$brand" params={{ brand: slug }}>
            {brand ?? "Inverters"}
          </BackLink>
        }
        title={
          brand ? (hasHybrid ? `Add a ${brand} inverter` : `Connect your ${brand} inverter`) : "Connect an inverter"
        }
        sub={
          !brand
            ? ""
            : hasHybrid
              ? "A second solar inverter, or a new one to replace yours. Find it with a quick scan, or enter its address."
              : "Nothing is recorded until your main inverter (with the battery and meter) is connected. Find it with a quick scan, or enter its address."
        }
      />
      {isPending && <PageLoading label="Checking what's connected" />}
      {error && <PageProblem>{errorMessage(error)}</PageProblem>}
      {data && !data.available && <PageProblem tone="plain">{data.error}</PageProblem>}
      {data?.available && !brand && (
        <PageProblem tone="plain">
          WattsMyPower doesn't read that brand. Go back to Inverters to choose yours.
        </PageProblem>
      )}
      {data?.available && data.read_only && (
        <SettingsSection id="h-read-only" title="Read only">
          <ReadOnlyNote />
        </SettingsSection>
      )}
      {data?.available && !data.read_only && brand && (
        <>
          {setup && <Notice tone="info">{setup}</Notice>}
          <ConnectInverter
            key={brand}
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
        </>
      )}
    </>
  );
}
