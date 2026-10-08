import { createFileRoute } from "@tanstack/react-router";
import { AlertSettings } from "~/features/alerts/components/AlertSettings";
import { PageHeader } from "~/features/common/layout/components/PageHeader";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "Alerts · WattsMyPower" }] }),
  component: () => (
    <>
      <PageHeader title="Alerts" sub="What to tell you about, where it goes, and what's been sent" />
      <AlertSettings />
    </>
  ),
});
