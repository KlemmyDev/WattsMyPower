import { createFileRoute } from "@tanstack/react-router";
import { InverterSettings } from "~/features/integrations/components/InverterSettings";

export const Route = createFileRoute("/_app/integrations/inverters/")({
  head: () => ({ meta: [{ title: "Inverters · Integrations · WattsMyPower" }] }),
  component: InverterSettings,
});
