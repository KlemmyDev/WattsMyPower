import { createFileRoute, redirect } from "@tanstack/react-router";
import { sessionQuery } from "~/features/auth/api";
import { LoginPage } from "~/features/auth/components/LoginPage";

type Search = { redirect?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    // Only same-site paths, so the link can't send someone elsewhere after signing in.
    redirect:
      typeof s.redirect === "string" && s.redirect.startsWith("/") && !s.redirect.startsWith("//")
        ? s.redirect
        : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (session.authenticated) throw redirect({ to: search.redirect || "/", replace: true });
  },
  head: () => ({ meta: [{ title: "Sign in · WattsMyPower" }] }),
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: to } = Route.useSearch();
  return <LoginPage redirectTo={to} />;
}
