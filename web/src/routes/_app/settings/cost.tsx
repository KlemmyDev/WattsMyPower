import { createFileRoute } from "@tanstack/react-router";
import { OwnershipSettings } from "~/features/settings/components/OwnershipSettings";

export const Route = createFileRoute("/_app/settings/cost")({
  head: () => ({ meta: [{ title: "Cost and warranty · Settings · WattsMyPower" }] }),
  component: OwnershipSettings,
});
