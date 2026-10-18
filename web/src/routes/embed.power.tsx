import { createFileRoute } from "@tanstack/react-router";
import { EmbedPower } from "~/features/embed/components/EmbedPower";

type Search = { token: string };

/** The power summary for another website's frame (Settings → Embed): outside the dashboard's own pages, no sign-in. */
export const Route = createFileRoute("/embed/power")({
  validateSearch: (s: Record<string, unknown>): Search => ({ token: typeof s.token === "string" ? s.token : "" }),
  head: () => ({ meta: [{ title: "Power · WattsMyPower" }, { name: "robots", content: "noindex" }] }),
  component: EmbedRoute,
});

function EmbedRoute() {
  const { token } = Route.useSearch();
  return <EmbedPower token={token} />;
}
