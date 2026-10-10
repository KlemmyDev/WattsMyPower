import { createFileRoute } from "@tanstack/react-router";
import { UpdatesSettings } from "~/features/updates/components/UpdatesSettings";

export const Route = createFileRoute("/_app/system/updates")({
  head: () => ({ meta: [{ title: "Updates · System · WattsMyPower" }] }),
  component: UpdatesSettings,
});
