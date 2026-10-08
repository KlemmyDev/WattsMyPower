import { createFileRoute } from "@tanstack/react-router";
import { CarPage } from "~/features/car/components/CarSettings";

export const Route = createFileRoute("/_app/integrations/car/$carId")({
  head: () => ({ meta: [{ title: "Car · Integrations · WattsMyPower" }] }),
  component: function Car() {
    const { carId } = Route.useParams();
    return <CarPage carId={Number(carId)} />;
  },
});
