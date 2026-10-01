import { createFileRoute } from "@tanstack/react-router";
import { SavingsPage } from "~/features/savings/components/SavingsPage";

export const Route = createFileRoute("/_app/savings")({
  head: () => ({ meta: [{ title: "Savings · WattsMyPower" }] }),
  component: SavingsPage,
});
