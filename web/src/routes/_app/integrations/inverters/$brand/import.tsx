import { createFileRoute, redirect } from "@tanstack/react-router";
import { SungrowImport } from "~/features/integrations/components/SungrowImport";

/** Importing history from iSolarCloud: a Sungrow's only. */
export const Route = createFileRoute("/_app/integrations/inverters/$brand/import")({
  beforeLoad: ({ params }) => {
    if (params.brand !== "sungrow")
      throw redirect({ to: "/integrations/inverters/$brand", params: { brand: params.brand }, replace: true });
  },
  head: () => ({ meta: [{ title: "History from iSolarCloud · Sungrow · Integrations · WattsMyPower" }] }),
  component: SungrowImport,
});
