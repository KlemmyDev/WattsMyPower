import { createFileRoute } from "@tanstack/react-router";
import { BillingSettings } from "~/features/settings/components/BillingSettings";

export const Route = createFileRoute("/_app/settings/billing")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: BillingSettings,
});
