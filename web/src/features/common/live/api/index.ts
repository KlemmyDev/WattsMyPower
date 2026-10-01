import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { LiveStatus, SystemInfo } from "~/features/common/live/types";

/**
 * Query keys starting with POLL are refetched (when in use) every time a new inverter reading
 * arrives over the live stream, so figures for "today" keep moving. See LiveProvider.
 */
export const POLL = "poll";

export const liveQuery = queryOptions({
  queryKey: ["live"],
  queryFn: ({ signal }) => apiGet<LiveStatus>("live", undefined, { signal }),
  staleTime: Infinity, // kept current by the event stream
});

/** Merge saved values into the cached live status, so every page sees them before the next poll. */
export function patchSystem(qc: QueryClient, patch: Partial<SystemInfo>) {
  qc.setQueryData(liveQuery.queryKey, (s) => (s ? { ...s, system: { ...s.system, ...patch } } : s));
}
