import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsHub } from "~/features/settings/components/SettingsHub";

/** Settings became the pages under Manage: old links and bookmarks to it land on System. */
export const Route = createFileRoute("/_app/settings/")({
  head: () => ({ meta: [{ title: "Settings · WattsMyPower" }] }),
  // Updates was a section of this page: links to it ("/settings#updates") land on its own.
  beforeLoad: ({ location }) => {
    if (location.hash === "updates") throw redirect({ to: "/settings/updates", replace: true });
  },
  component: SettingsHub,
});
