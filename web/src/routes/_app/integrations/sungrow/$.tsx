import { createFileRoute, redirect } from "@tanstack/react-router";

/** Inverters had a Sungrow page before other brands came along: old links and bookmarks land on Inverters. */
export const Route = createFileRoute("/_app/integrations/sungrow/$")({
  beforeLoad: ({ params, location }) => {
    const rest = params._splat ? `/${params._splat}` : "";
    throw redirect({
      href: `/integrations/inverters${rest}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  },
});
