import { createFileRoute } from "@tanstack/react-router";
import { IntegrationSettings } from "~/features/settings/components/IntegrationSettings";

export const Route = createFileRoute("/_app/settings/integrations")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: IntegrationSettings,
});
