import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/features/home/components/HomePage";

export const Route = createFileRoute("/_app/home")({
  head: () => ({ meta: [{ title: "Home · WattsMyPower" }] }),
  component: HomePage,
});
