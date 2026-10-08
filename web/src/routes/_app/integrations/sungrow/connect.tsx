import { createFileRoute } from "@tanstack/react-router";
import { SungrowConnect } from "~/features/integrations/components/SungrowConnect";

export const Route = createFileRoute("/_app/integrations/sungrow/connect")({
  head: () => ({ meta: [{ title: "Connect an inverter · Integrations · WattsMyPower" }] }),
  component: SungrowConnect,
});
