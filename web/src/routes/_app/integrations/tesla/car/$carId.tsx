import { createFileRoute } from "@tanstack/react-router";
import { CarPage } from "~/features/car/components/CarPage";

export const Route = createFileRoute("/_app/integrations/tesla/car/$carId")({
  head: () => ({ meta: [{ title: "Car · Tesla · Integrations · WattsMyPower" }] }),
  component: function Car() {
    const { carId } = Route.useParams();
    return <CarPage carId={Number(carId)} />;
  },
});
