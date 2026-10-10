import { createFileRoute } from "@tanstack/react-router";
import { HouseSettings } from "~/features/settings/components/HouseSettings";

export const Route = createFileRoute("/_app/settings/house")({
  head: () => ({ meta: [{ title: "Your house · Settings · WattsMyPower" }] }),
  component: HouseSettings,
});
