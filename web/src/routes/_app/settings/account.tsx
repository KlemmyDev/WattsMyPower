import { createFileRoute } from "@tanstack/react-router";
import { AccountSettings } from "~/features/auth/components/AccountSettings";

export const Route = createFileRoute("/_app/settings/account")({
  head: () => ({ meta: [{ title: "Account · Settings · WattsMyPower" }] }),
  component: AccountSettings,
});
