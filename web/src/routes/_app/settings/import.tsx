import { createFileRoute, redirect } from "@tanstack/react-router";

/** Importing moved to Settings → Integrations → Sungrow: old links and bookmarks land there. */
export const Route = createFileRoute("/_app/settings/import")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/integrations/sungrow/import", replace: true });
  },
});
