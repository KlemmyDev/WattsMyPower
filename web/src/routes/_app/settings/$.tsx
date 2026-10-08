import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings' pages became sections of their own: old links and bookmarks land on them there. */
const MOVED: Record<string, { to: string; hash?: string }> = {
  system: { to: "/system" },
  bills: { to: "/bills/rates" },
  billing: { to: "/bills/rates", hash: "period" },
  tariffs: { to: "/bills/rates", hash: "rates" },
  integrations: { to: "/integrations" },
  import: { to: "/integrations/sungrow/import" },
  database: { to: "/data" },
  account: { to: "/account" },
};

export const Route = createFileRoute("/_app/settings/$")({
  beforeLoad: ({ params, location }) => {
    const [first, ...rest] = (params._splat ?? "").split("/");
    const to = MOVED[first];
    // Integrations keep their own pages ("/settings/integrations/sungrow" → "/integrations/sungrow").
    const path = to ? [to.to, ...(first === "integrations" ? rest : [])].join("/") : "/system";
    const hash = location.hash || to?.hash;
    throw redirect({ href: `${path}${hash ? `#${hash}` : ""}`, replace: true });
  },
});
