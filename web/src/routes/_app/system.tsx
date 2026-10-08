import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { SystemSettings } from "~/features/settings/components/SystemSettings";

export const Route = createFileRoute("/_app/system")({
  head: () => ({ meta: [{ title: "System · WattsMyPower" }] }),
  component: () => (
    <>
      <PageHeader title="System" sub="Your solar and battery system, where it is, and updates to the dashboard" />
      <SystemSettings />
    </>
  ),
});
