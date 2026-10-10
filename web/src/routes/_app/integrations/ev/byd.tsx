import { createFileRoute } from "@tanstack/react-router";
import { BydSettings } from "~/features/ev/components/BydSettings";

export const Route = createFileRoute("/_app/integrations/ev/byd")({
  head: () => ({ meta: [{ title: "BYD · Electric vehicles · Integrations · WattsMyPower" }] }),
  component: BydSettings,
});
