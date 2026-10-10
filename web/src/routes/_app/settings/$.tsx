import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old Settings links that aren't one of its pages now (some became sections of their own) land where they went. */
const MOVED: Record<string, { to: string; hash?: string }> = {
  system: { to: "/settings" },
  bills: { to: "/bills/rates" },
  billing: { to: "/bills/rates", hash: "period" },
  tariffs: { to: "/bills/rates", hash: "rates" },
  integrations: { to: "/integrations" },
  import: { to: "/integrations/inverters/sungrow/import" },
  database: { to: "/settings/data" },
};

export const Route = createFileRoute("/_app/settings/$")({
  beforeLoad: ({ params, location }) => {
    const [first, ...rest] = (params._splat ?? "").split("/");
    const to = MOVED[first];
    // Integrations keep their own pages ("/settings/integrations/inverters" → "/integrations/inverters").
    const path = to ? [to.to, ...(first === "integrations" ? rest : [])].join("/") : "/settings";
    const hash = location.hash || to?.hash;
    throw redirect({ href: `${path}${hash ? `#${hash}` : ""}`, replace: true });
  },
});
