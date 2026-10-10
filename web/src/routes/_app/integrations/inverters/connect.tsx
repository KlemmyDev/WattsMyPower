import { createFileRoute } from "@tanstack/react-router";
import { InverterConnect } from "~/features/integrations/components/InverterConnect";

/** `brand` (from Add an integration) picks which brand's inverters the address form offers first. */
export const Route = createFileRoute("/_app/integrations/inverters/connect")({
  validateSearch: (search: Record<string, unknown>): { brand?: string } =>
    typeof search.brand === "string" && search.brand ? { brand: search.brand } : {},
  head: () => ({ meta: [{ title: "Connect an inverter · Integrations · WattsMyPower" }] }),
  component: ConnectPage,
});

function ConnectPage() {
  const { brand } = Route.useSearch();
  return <InverterConnect brand={brand} />;
}
