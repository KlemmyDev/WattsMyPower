import { createFileRoute } from "@tanstack/react-router";
import { MeterComparison } from "~/features/meter/components/MeterComparison";
import { MeterDataSettings } from "~/features/meter/components/MeterDataSettings";
import { BillingSettings } from "~/features/settings/components/BillingSettings";

export const Route = createFileRoute("/_app/settings/billing")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: BillingPage,
});

/** Settings → Billing: the billing period, then the smart meter's data and how it compares with the dashboard. */
function BillingPage() {
  return (
    <>
      <BillingSettings />
      <MeterDataSettings />
      <MeterComparison />
    </>
  );
}
