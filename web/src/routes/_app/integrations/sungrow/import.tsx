import { createFileRoute } from "@tanstack/react-router";
import { SungrowImport } from "~/features/integrations/components/SungrowImport";

export const Route = createFileRoute("/_app/integrations/sungrow/import")({
  head: () => ({ meta: [{ title: "Import history · Integrations · WattsMyPower" }] }),
  component: SungrowImport,
});
