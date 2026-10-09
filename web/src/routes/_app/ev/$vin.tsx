import { createFileRoute } from "@tanstack/react-router";
import { EvPage } from "~/features/ev/components/EvPage";

/** One connected car's own page, as the side nav lists them under EV. */
export const Route = createFileRoute("/_app/ev/$vin")({
  head: () => ({ meta: [{ title: "EV · WattsMyPower" }] }),
  component: EvCarRoute,
});

function EvCarRoute() {
  const { vin } = Route.useParams();
  return <EvPage vin={vin} />;
}
