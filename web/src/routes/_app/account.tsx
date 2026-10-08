import { createFileRoute } from "@tanstack/react-router";
import { AccountSettings } from "~/features/auth/components/AccountSettings";
import { PageHeader } from "~/features/common/layout/components/PageHeader";

export const Route = createFileRoute("/_app/account")({
  head: () => ({ meta: [{ title: "Account · WattsMyPower" }] }),
  component: () => (
    <>
      <PageHeader title="Account" sub="Signing in, and how the dashboard looks" />
      <AccountSettings />
    </>
  ),
});
