import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { GridView } from "~/features/grid/types";

const MIN = 60_000;

/** The grid's market, notices and outlook. AEMO publishes every five minutes; checked every minute while shown. */
export const gridQuery = queryOptions({
  queryKey: ["grid"],
  queryFn: ({ signal }) => apiGet<GridView>("grid", undefined, { signal }),
  staleTime: MIN,
  // Every few seconds until the weather and fire warnings have first answered (just after start-up), then each minute.
  refetchInterval: (q) => {
    const h = q.state.data?.hazards;
    const waiting = h?.enabled && Object.values(h.sources).some((s) => s && s.at == null && !s.error);
    return waiting ? 4000 : MIN;
  },
});

/** Fetch from AEMO now (after a failed fetch). */
export const refreshGrid = () => apiSend<GridView>("POST", "grid/refresh");
