import { createFileRoute } from "@tanstack/react-router";
import { EvSettings } from "~/features/ev/components/EvSettings";

export const Route = createFileRoute("/_app/integrations/ev/")({
  head: () => ({ meta: [{ title: "Electric vehicles · Integrations · WattsMyPower" }] }),
  component: EvSettings,
});
