import { createFileRoute, redirect } from "@tanstack/react-router";
import { InverterDetail } from "~/features/integrations/components/InverterDetail";
import { asRole, ROLE_NAME } from "~/features/integrations/utils";

export const Route = createFileRoute("/_app/integrations/inverters/$brand/$role")({
  // /integrations/sungrow/connect from before brands had pages of their own lands on connecting a Sungrow.
  beforeLoad: ({ params }) => {
    if (params.role === "connect")
      throw redirect({ to: "/integrations/inverters/connect", search: { brand: params.brand }, replace: true });
  },
  head: ({ params }) => {
    const role = asRole(params.role);
    const name = role ? ROLE_NAME[role].replace(/^./, (c) => c.toUpperCase()) : "Inverter";
    return { meta: [{ title: `${name} · Inverters · Integrations · WattsMyPower` }] };
  },
  component: function InverterPage() {
    const { brand, role } = Route.useParams();
    return <InverterDetail brand={brand} role={role} />;
  },
});
