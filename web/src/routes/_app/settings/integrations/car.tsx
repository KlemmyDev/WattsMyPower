import { createFileRoute } from "@tanstack/react-router";
import { CarSettings } from "~/features/car/components/CarSettings";

export const Route = createFileRoute("/_app/settings/integrations/car")({
  head: () => ({ meta: [{ title: "Electric vehicle · Settings · WattsMyPower" }] }),
  component: CarSettings,
});
