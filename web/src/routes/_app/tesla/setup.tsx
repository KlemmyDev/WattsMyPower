import { createFileRoute } from "@tanstack/react-router";
import { TeslaSetupPage } from "~/features/tesla/components/TeslaSetupPage";

export const Route = createFileRoute("/_app/tesla/setup")({
  head: () => ({ meta: [{ title: "Connect Tesla · WattsMyPower" }] }),
  component: TeslaSetupPage,
});
