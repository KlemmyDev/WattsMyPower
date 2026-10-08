import { createFileRoute } from "@tanstack/react-router";
import { SungrowSettings } from "~/features/integrations/components/SungrowSettings";

export const Route = createFileRoute("/_app/integrations/sungrow/")({
  head: () => ({ meta: [{ title: "Sungrow · Integrations · WattsMyPower" }] }),
  component: SungrowSettings,
});
