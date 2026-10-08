import { createFileRoute } from "@tanstack/react-router";
import { GridPage } from "~/features/grid/components/GridPage";

export const Route = createFileRoute("/_app/grid")({
  head: () => ({ meta: [{ title: "Grid · WattsMyPower" }] }),
  component: GridPage,
});
