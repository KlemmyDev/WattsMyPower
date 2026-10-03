import { ImportSettings } from "~/features/imports/components/ImportSettings";
import { BackLink } from "~/features/settings/components/SubPageHeader";

/** Settings → Integrations → Sungrow → importing history from iSolarCloud (its first card says what it's for). */
export function SungrowImport() {
  return (
    <>
      <BackLink to="/settings/integrations/sungrow" className="pt-1">
        Sungrow
      </BackLink>
      <ImportSettings />
    </>
  );
}
