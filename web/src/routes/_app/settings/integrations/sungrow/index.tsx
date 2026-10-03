import { createFileRoute } from "@tanstack/react-router";
import { SungrowSettings } from "~/features/integrations/components/SungrowSettings";

export const Route = createFileRoute("/_app/settings/integrations/sungrow/")({
  head: () => ({ meta: [{ title: "Sungrow · Settings · WattsMyPower" }] }),
  component: SungrowSettings,
});
