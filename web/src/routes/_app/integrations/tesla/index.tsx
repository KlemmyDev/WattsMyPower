import { createFileRoute } from "@tanstack/react-router";
import { TeslaSettings } from "~/features/ev/components/TeslaSettings";

export const Route = createFileRoute("/_app/integrations/tesla/")({
  head: () => ({ meta: [{ title: "Tesla · Integrations · WattsMyPower" }] }),
  component: TeslaSettings,
});
