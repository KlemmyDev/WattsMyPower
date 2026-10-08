import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { GridView } from "~/features/grid/types";

const MIN = 60_000;

/** The grid's market, notices and outlook. AEMO publishes every five minutes; checked every minute while shown. */
export const gridQuery = queryOptions({
  queryKey: ["grid"],
  queryFn: ({ signal }) => apiGet<GridView>("grid", undefined, { signal }),
  staleTime: MIN,
  refetchInterval: MIN,
});

/** Fetch from AEMO now (after a failed fetch). */
export const refreshGrid = () => apiSend<GridView>("POST", "grid/refresh");
