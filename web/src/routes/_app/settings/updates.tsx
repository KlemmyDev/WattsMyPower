import { createFileRoute } from "@tanstack/react-router";
import { UpdatesSettings } from "~/features/updates/components/UpdatesSettings";

export const Route = createFileRoute("/_app/settings/updates")({
  head: () => ({ meta: [{ title: "Updates · Settings · WattsMyPower" }] }),
  component: UpdatesSettings,
});
