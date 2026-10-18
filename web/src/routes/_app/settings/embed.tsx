import { createFileRoute } from "@tanstack/react-router";
import { EmbedSettings } from "~/features/embed/components/EmbedSettings";

export const Route = createFileRoute("/_app/settings/embed")({
  head: () => ({ meta: [{ title: "Embed · Settings · WattsMyPower" }] }),
  component: EmbedSettings,
});
