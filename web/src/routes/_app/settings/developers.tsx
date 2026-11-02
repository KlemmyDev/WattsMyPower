import { createFileRoute } from "@tanstack/react-router";
import { DeveloperSettings } from "~/features/developers/components/DeveloperSettings";

export const Route = createFileRoute("/_app/settings/developers")({
  head: () => ({ meta: [{ title: "Developers · Settings · WattsMyPower" }] }),
  component: DeveloperSettings,
});
