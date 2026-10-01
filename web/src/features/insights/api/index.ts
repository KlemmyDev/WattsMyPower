import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Insights } from "~/features/insights/types";

export const insightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: ({ signal }) => apiGet<Insights>("insights", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});
