import { createFileRoute } from "@tanstack/react-router";
import { ImportSettings } from "~/features/imports/components/ImportSettings";

export const Route = createFileRoute("/_app/settings/import")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: ImportSettings,
});
