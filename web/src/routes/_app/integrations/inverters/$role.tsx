import { createFileRoute } from "@tanstack/react-router";
import { InverterDetail } from "~/features/integrations/components/InverterDetail";
import { asRole, ROLE_NAME } from "~/features/integrations/utils";

export const Route = createFileRoute("/_app/integrations/inverters/$role")({
  head: ({ params }) => {
    const role = asRole(params.role);
    const name = role ? ROLE_NAME[role].replace(/^./, (c) => c.toUpperCase()) : "Inverter";
    return { meta: [{ title: `${name} · Integrations · WattsMyPower` }] };
  },
  component: InverterPage,
});

function InverterPage() {
  const { role } = Route.useParams();
  return <InverterDetail role={role} />;
}
