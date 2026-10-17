import { createFileRoute } from "@tanstack/react-router";
import { LiveLayout } from "~/features/live/components/LiveLayout";

/** The live pages, around the top card they share. */
export const Route = createFileRoute("/_app/_live")({
  component: LiveLayout,
});
