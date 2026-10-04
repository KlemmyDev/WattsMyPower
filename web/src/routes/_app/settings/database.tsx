import { createFileRoute } from "@tanstack/react-router";
import { DatabaseSettings } from "~/features/storage/components/DatabaseSettings";

export const Route = createFileRoute("/_app/settings/database")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: DatabaseSettings,
});
