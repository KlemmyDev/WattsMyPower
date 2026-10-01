import { createFileRoute } from "@tanstack/react-router";
import { TeslaPage } from "~/features/tesla/components/TeslaPage";

export const Route = createFileRoute("/_app/tesla/")({
  head: () => ({ meta: [{ title: "Tesla · WattsMyPower" }] }),
  component: TeslaPage,
});
