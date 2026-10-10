import { createFileRoute } from "@tanstack/react-router";
import { InverterBrand } from "~/features/integrations/components/InverterSettings";

export const Route = createFileRoute("/_app/integrations/inverters/$brand/")({
  head: () => ({ meta: [{ title: "Inverters · Integrations · WattsMyPower" }] }),
  component: function BrandPage() {
    const { brand } = Route.useParams();
    return <InverterBrand slug={brand} />;
  },
});
