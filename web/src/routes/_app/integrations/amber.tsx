import { createFileRoute } from "@tanstack/react-router";
import { AmberSettings } from "~/features/amber/components/AmberSettings";

export const Route = createFileRoute("/_app/integrations/amber")({
  head: () => ({ meta: [{ title: "Amber Electric · Integrations · WattsMyPower" }] }),
  component: AmberSettings,
});
