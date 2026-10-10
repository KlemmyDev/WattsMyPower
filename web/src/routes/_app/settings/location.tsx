import { createFileRoute } from "@tanstack/react-router";
import { LocationSettings } from "~/features/settings/components/LocationSettings";

export const Route = createFileRoute("/_app/settings/location")({
  head: () => ({ meta: [{ title: "Location · Settings · WattsMyPower" }] }),
  component: LocationSettings,
});
