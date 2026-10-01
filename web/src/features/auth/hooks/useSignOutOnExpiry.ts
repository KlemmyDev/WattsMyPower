import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { sessionQuery } from "~/features/auth/api";

/** If the session ends while the dashboard is open (any API call returns 401), go to the sign-in page. */
export function useSignOutOnExpiry() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(sessionQuery.queryKey, (s) => (s ? { ...s, authenticated: false } : s));
      navigate({ to: "/login", search: { redirect: href }, replace: true });
    };
    window.addEventListener("wmp:unauthorized", onUnauthorized);
    return () => window.removeEventListener("wmp:unauthorized", onUnauthorized);
  }, [qc, navigate, href]);
}
