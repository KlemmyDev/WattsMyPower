import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { SolarInsights } from "~/features/solar/types";

/** Solar performance and its trend. The same response (and cache) as the Battery page's insights. */
export const solarInsightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: ({ signal }) => apiGet<SolarInsights>("insights", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});
