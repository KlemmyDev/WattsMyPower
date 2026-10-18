import { createFileRoute } from "@tanstack/react-router";
import { EmbedPower } from "~/features/embed/components/EmbedPower";
import { VARIANTS, type EmbedTheme, type EmbedVariant } from "~/features/embed/types";

type Search = { token: string; variant: EmbedVariant; theme: EmbedTheme; transparent: boolean };

/** The power summary for another website's frame (Settings → Embed): outside the dashboard's own pages, no sign-in. */
export const Route = createFileRoute("/embed/power")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === "string" || typeof s.token === "number" ? String(s.token) : "",
    variant: VARIANTS.find((v) => v === s.variant) ?? "tiles",
    theme: s.theme === "light" || s.theme === "dark" ? s.theme : "auto",
    transparent: s.transparent === true || s.transparent === 1 || s.transparent === "1" || s.transparent === "true",
  }),
  head: () => ({ meta: [{ title: "Power · WattsMyPower" }, { name: "robots", content: "noindex" }] }),
  component: EmbedRoute,
});

function EmbedRoute() {
  const { token, variant, theme, transparent } = Route.useSearch();
  return <EmbedPower token={token} variant={variant} theme={theme} transparent={transparent} />;
}
