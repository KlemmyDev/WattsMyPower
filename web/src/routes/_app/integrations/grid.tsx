import { createFileRoute } from "@tanstack/react-router";
import { GridSettings } from "~/features/grid/components/GridSettings";

export const Route = createFileRoute("/_app/integrations/grid")({
  head: () => ({ meta: [{ title: "Grid · Integrations · WattsMyPower" }] }),
  component: GridSettings,
});
