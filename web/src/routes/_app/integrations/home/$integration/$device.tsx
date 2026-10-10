import { createFileRoute } from "@tanstack/react-router";
import { HomeDeviceSettings } from "~/features/home/components/HomeDeviceSettings";

export const Route = createFileRoute("/_app/integrations/home/$integration/$device")({
  head: () => ({ meta: [{ title: "Device · Smart home · Integrations · WattsMyPower" }] }),
  component: function DeviceRoute() {
    const { integration, device } = Route.useParams();
    return <HomeDeviceSettings integrationId={integration} deviceId={Number(device)} />;
  },
});
