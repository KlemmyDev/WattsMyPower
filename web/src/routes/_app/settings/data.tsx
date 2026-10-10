import { createFileRoute } from "@tanstack/react-router";
import { DatabaseSettings } from "~/features/storage/components/DatabaseSettings";

export const Route = createFileRoute("/_app/settings/data")({
  head: () => ({ meta: [{ title: "Data · Settings · WattsMyPower" }] }),
  component: DatabaseSettings,
});
