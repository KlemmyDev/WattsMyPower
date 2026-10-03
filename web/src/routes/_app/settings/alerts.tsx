import { createFileRoute } from "@tanstack/react-router";
import { AlertSettings } from "~/features/alerts/components/AlertSettings";

export const Route = createFileRoute("/_app/settings/alerts")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: AlertSettings,
});
