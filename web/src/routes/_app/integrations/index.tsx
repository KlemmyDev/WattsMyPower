import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { IntegrationSettings } from "~/features/integrations/components/IntegrationSettings";

export const Route = createFileRoute("/_app/integrations/")({
  head: () => ({ meta: [{ title: "Integrations · WattsMyPower" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <>
      <PageHeader title="Integrations" sub="Your inverters, smart home, cars, and the services the dashboard reads" />
      <IntegrationSettings />
    </>
  );
}
