import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Checkup, Insights } from "~/features/health/types";

export const insightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: ({ signal }) => apiGet<Insights>("insights", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});

/** Each part of the system green, amber or red: live, so it follows the inverter minute by minute. */
export const checkupQuery = queryOptions({
  queryKey: ["insights", "checkup"],
  queryFn: ({ signal }) => apiGet<Checkup>("insights/checkup", undefined, { signal }),
  staleTime: 60_000,
  refetchInterval: 60_000,
});
