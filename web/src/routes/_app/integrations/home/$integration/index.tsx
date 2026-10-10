import { createFileRoute } from "@tanstack/react-router";
import { HomeIntegrationSettings } from "~/features/home/components/HomeIntegrationSettings";

export const Route = createFileRoute("/_app/integrations/home/$integration/")({
  head: () => ({ meta: [{ title: "Smart home · Integrations · WattsMyPower" }] }),
  component: HomeIntegrationRoute,
});

function HomeIntegrationRoute() {
  const { integration } = Route.useParams();
  return <HomeIntegrationSettings id={integration} />;
}
