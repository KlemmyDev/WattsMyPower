import { createFileRoute } from "@tanstack/react-router";
import { GridSettings } from "~/features/grid/components/GridSettings";

export const Route = createFileRoute("/_app/settings/integrations/grid")({
  head: () => ({ meta: [{ title: "Grid · Settings · WattsMyPower" }] }),
  component: GridSettings,
});
