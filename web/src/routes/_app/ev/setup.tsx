import { createFileRoute } from "@tanstack/react-router";
import { EvSetupPage } from "~/features/ev/components/EvSetupPage";

export const Route = createFileRoute("/_app/ev/setup")({
  head: () => ({ meta: [{ title: "Connect your EV · WattsMyPower" }] }),
  component: EvSetupPage,
});
