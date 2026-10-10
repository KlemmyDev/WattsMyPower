import { createFileRoute } from "@tanstack/react-router";
import { SmartHomeSettings } from "~/features/home/components/SmartHomeSettings";

export const Route = createFileRoute("/_app/integrations/home/")({
  head: () => ({ meta: [{ title: "Smart home · Integrations · WattsMyPower" }] }),
  component: SmartHomeSettings,
});
