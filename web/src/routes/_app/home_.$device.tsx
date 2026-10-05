import { createFileRoute } from "@tanstack/react-router";
import { DevicePage } from "~/features/home/components/DevicePage";

export const Route = createFileRoute("/_app/home_/$device")({
  head: () => ({ meta: [{ title: "Device · WattsMyPower" }] }),
  component: DeviceRoute,
});

function DeviceRoute() {
  const { device } = Route.useParams();
  return <DevicePage id={Number(device)} />;
}
