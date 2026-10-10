import { createFileRoute } from "@tanstack/react-router";
import { InverterConnect } from "~/features/integrations/components/InverterConnect";

export const Route = createFileRoute("/_app/integrations/inverters/$brand/connect")({
  head: () => ({ meta: [{ title: "Connect an inverter · Integrations · WattsMyPower" }] }),
  component: function ConnectPage() {
    const { brand } = Route.useParams();
    return <InverterConnect slug={brand} />;
  },
});
