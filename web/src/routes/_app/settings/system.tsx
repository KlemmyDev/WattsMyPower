import { createFileRoute } from "@tanstack/react-router";
import { SystemSettings } from "~/features/settings/components/SystemSettings";

export const Route = createFileRoute("/_app/settings/system")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: SystemSettings,
});
