import { createFileRoute } from "@tanstack/react-router";
import { LocationSettings } from "~/features/settings/components/LocationSettings";

export const Route = createFileRoute("/_app/system/location")({
  head: () => ({ meta: [{ title: "Location · System · WattsMyPower" }] }),
  component: LocationSettings,
});
