import { ImportSettings } from "~/features/imports/components/ImportSettings";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Manage → Integrations → Inverters → Sungrow → importing history from iSolarCloud. */
export function SungrowImport() {
  return (
    <>
      <SubPageHeader
        back={
          <BackLink to="/integrations/inverters/$brand" params={{ brand: "sungrow" }}>
            Sungrow
          </BackLink>
        }
        title="History from iSolarCloud"
        sub="Fill in the days before WattsMyPower was set up, or any gaps, from iSolarCloud's 5-minute exports."
      />
      <ImportSettings />
    </>
  );
}
