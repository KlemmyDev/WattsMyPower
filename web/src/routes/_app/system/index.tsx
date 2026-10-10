import { createFileRoute, redirect } from "@tanstack/react-router";
import { SystemHub } from "~/features/settings/components/SystemHub";

export const Route = createFileRoute("/_app/system/")({
  head: () => ({ meta: [{ title: "System · WattsMyPower" }] }),
  // Updates was a section of this page: links to it ("/system#updates") land on its own.
  beforeLoad: ({ location }) => {
    if (location.hash === "updates") throw redirect({ to: "/system/updates", replace: true });
  },
  component: SystemHub,
});
