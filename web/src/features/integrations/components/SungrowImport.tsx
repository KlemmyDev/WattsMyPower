import { ImportSettings } from "~/features/imports/components/ImportSettings";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Manage → Integrations → Inverters → importing history from iSolarCloud. */
export function SungrowImport() {
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations/inverters">Inverters</BackLink>}
        id="h-import-page"
        title="History from iSolarCloud"
        sub="For a Sungrow: bring in the days before WattsMyPower was set up, or fill gaps, from iSolarCloud's 5-minute exports."
      />
      <ImportSettings />
    </>
  );
}
