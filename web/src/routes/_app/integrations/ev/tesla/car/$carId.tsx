import { createFileRoute } from "@tanstack/react-router";
import { CarPage } from "~/features/car/components/CarPage";

export const Route = createFileRoute("/_app/integrations/ev/tesla/car/$carId")({
  head: () => ({ meta: [{ title: "Car · Tesla · Electric vehicles · Integrations · WattsMyPower" }] }),
  component: function Car() {
    const { carId } = Route.useParams();
    return <CarPage carId={Number(carId)} />;
  },
});
