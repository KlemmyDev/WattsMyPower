import { createFileRoute } from "@tanstack/react-router";
import { OwnershipSettings } from "~/features/settings/components/OwnershipSettings";

export const Route = createFileRoute("/_app/system/cost")({
  head: () => ({ meta: [{ title: "Cost and warranty · System · WattsMyPower" }] }),
  component: OwnershipSettings,
});
