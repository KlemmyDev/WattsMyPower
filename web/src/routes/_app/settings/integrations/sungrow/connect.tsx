import { createFileRoute } from "@tanstack/react-router";
import { SungrowConnect } from "~/features/integrations/components/SungrowConnect";

export const Route = createFileRoute("/_app/settings/integrations/sungrow/connect")({
  head: () => ({ meta: [{ title: "Connect an inverter · Settings · WattsMyPower" }] }),
  component: SungrowConnect,
});
