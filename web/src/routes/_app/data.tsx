import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { DatabaseSettings } from "~/features/storage/components/DatabaseSettings";

export const Route = createFileRoute("/_app/data")({
  head: () => ({ meta: [{ title: "Data · WattsMyPower" }] }),
  component: () => (
    <>
      <PageHeader title="Data" sub="What's stored, and how much room it takes" />
      <DatabaseSettings />
    </>
  ),
});
