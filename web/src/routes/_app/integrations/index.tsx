import { createFileRoute } from "@tanstack/react-router";
import { IntegrationSettings } from "~/features/integrations/components/IntegrationSettings";

export const Route = createFileRoute("/_app/integrations/")({
  head: () => ({ meta: [{ title: "Integrations · WattsMyPower" }] }),
  component: IntegrationSettings,
});
