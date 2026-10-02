import { createFileRoute } from "@tanstack/react-router";
import { BillsPage } from "~/features/bills/components/BillsPage";

export const Route = createFileRoute("/_app/bills")({
  head: () => ({ meta: [{ title: "Bills · WattsMyPower" }] }),
  component: BillsPage,
});
