import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "~/routeTree.gen";

export type RouterContext = { queryClient: QueryClient };

// Links from the old dashboard used hash routes (#/settings/tariffs); carry them over.
function upgradeHashRoute() {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#/")) return;
  const path = window.location.hash.slice(1).replace(/^\/overview\b/, "") || "/";
  window.history.replaceState(null, "", path);
}

export function getRouter() {
  upgradeHashRoute();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
