import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Session } from "~/features/auth/types";

export const sessionQuery = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: ({ signal }) => apiGet<Session>("auth/session", undefined, { signal }),
  staleTime: 5 * 60_000,
});
