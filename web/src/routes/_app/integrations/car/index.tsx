import { createFileRoute } from "@tanstack/react-router";
import { CarSettings } from "~/features/car/components/CarSettings";

export const Route = createFileRoute("/_app/integrations/car/")({
  head: () => ({ meta: [{ title: "Electric vehicles · Integrations · WattsMyPower" }] }),
  component: CarSettings,
});
