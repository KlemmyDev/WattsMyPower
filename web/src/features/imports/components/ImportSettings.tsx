import { ExportGuide } from "~/features/imports/components/ExportGuide";
import { ImportUpload } from "~/features/imports/components/ImportUpload";
import { PastImports } from "~/features/imports/components/PastImports";

/** Settings → Integrations → Sungrow → Import: bring in history from iSolarCloud exports. */
export function ImportSettings() {
  return (
    <div className="flex flex-col gap-6">
      <ImportUpload />
      <PastImports />
      <ExportGuide />
    </div>
  );
}
