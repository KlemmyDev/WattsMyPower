import { ImportSettings } from "~/features/imports/components/ImportSettings";
import { BackLink } from "~/features/settings/components/SubPageHeader";

/** Manage → Integrations → Inverters → importing history from iSolarCloud (its first card says what it's for). */
export function SungrowImport() {
  return (
    <>
      <BackLink to="/integrations/inverters" className="pt-1">
        Sungrow
      </BackLink>
      <ImportSettings />
    </>
  );
}
