import { createFileRoute } from "@tanstack/react-router";
import { TeslaSettings } from "~/features/ev/components/TeslaSettings";

export const Route = createFileRoute("/_app/integrations/ev/tesla/")({
  head: () => ({ meta: [{ title: "Tesla · Electric vehicles · Integrations · WattsMyPower" }] }),
  component: TeslaSettings,
});
