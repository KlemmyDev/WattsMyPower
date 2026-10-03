import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, ScriptOnce, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "~/styles/app.css?url";
import { ToastProvider } from "~/features/common/ui/components/Toast";
import { useThemeSync } from "~/features/common/theme/hooks";
import { THEME_SCRIPT } from "~/features/common/theme/utils";
import { useDisplaySync } from "~/features/common/display/hooks";
import { DISPLAY_SCRIPT } from "~/features/common/display/utils";
import type { RouterContext } from "~/router";

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 30'><rect width='30' height='30' rx='9' fill='%23141414'/><path d='M16.6 6.8 L9.2 16.2 H14.4 L13.4 23.2 L20.8 13.8 H15.6 Z' fill='%23ffb547'/></svg>";

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "WattsMyPower" },
    ],
    links: [
      { rel: "icon", href: FAVICON },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  component: Root,
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  useThemeSync();
  useDisplaySync();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The theme and display scripts set attributes on <html> before React starts, so React mustn't mind them.
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Applies the saved theme (and its color-scheme and theme-color meta tags) before the
            body renders, so a light page never flashes dark first. It's in the prerendered shell
            only, and removes itself once it has run. */}
        <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
        {/* The same for the display choices (size, layout, contrast, motion), so the first paint is
            already at the chosen size. */}
        <ScriptOnce>{DISPLAY_SCRIPT}</ScriptOnce>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
