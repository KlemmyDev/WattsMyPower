import { createFileRoute } from "@tanstack/react-router";
import { TariffSettings } from "~/features/settings/components/TariffSettings";

export const Route = createFileRoute("/_app/settings/tariffs")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  component: TariffSettings,
});
