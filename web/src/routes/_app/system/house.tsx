import { createFileRoute } from "@tanstack/react-router";
import { HouseSettings } from "~/features/settings/components/HouseSettings";

export const Route = createFileRoute("/_app/system/house")({
  head: () => ({ meta: [{ title: "Your house · System · WattsMyPower" }] }),
  component: HouseSettings,
});
