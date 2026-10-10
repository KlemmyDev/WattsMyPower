import { createFileRoute } from "@tanstack/react-router";
import { BluelinkSettings } from "~/features/ev/components/BluelinkSettings";

export const Route = createFileRoute("/_app/integrations/ev/hyundai-kia")({
  head: () => ({ meta: [{ title: "Hyundai and Kia · Electric vehicles · Integrations · WattsMyPower" }] }),
  component: BluelinkSettings,
});
