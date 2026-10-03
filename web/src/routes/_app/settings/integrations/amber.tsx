import { createFileRoute } from "@tanstack/react-router";
import { AmberSettings } from "~/features/amber/components/AmberSettings";

export const Route = createFileRoute("/_app/settings/integrations/amber")({
  head: () => ({ meta: [{ title: "Amber Electric · Settings · WattsMyPower" }] }),
  component: AmberSettings,
});
