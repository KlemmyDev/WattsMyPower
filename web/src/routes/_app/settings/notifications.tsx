import { createFileRoute } from "@tanstack/react-router";
import { NotificationsSettings } from "~/features/notifications/components/NotificationsSettings";

export const Route = createFileRoute("/_app/settings/notifications")({
  head: () => ({ meta: [{ title: "Notifications · Settings · WattsMyPower" }] }),
  component: NotificationsSettings,
});
