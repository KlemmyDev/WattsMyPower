import { queryOptions } from "@tanstack/react-query";
import type { Session } from "~/features/auth/types";
import { ApiError, apiGet } from "~/features/common/api/utils";

/** A backend from before sign-in existed has no session endpoint: everything is open, as it was then. */
const NO_SIGN_IN: Session = { authenticated: true, setup_required: false, username: null, auth_enabled: false };

export const sessionQuery = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: async ({ signal }) => {
    try {
      return await apiGet<Session>("auth/session", undefined, { signal });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return NO_SIGN_IN;
      throw err;
    }
  },
  staleTime: 5 * 60_000,
});
