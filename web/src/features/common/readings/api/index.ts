import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import { POLL } from "~/features/common/live/api";
import type { CostsResponse, HistoryResponse } from "~/features/common/readings/types";

const MIN = 60_000;

/** Per-day costs from `start`. Without `end` it runs to now and refreshes with every reading. */
export const costsQuery = (start: number, end?: number) =>
  queryOptions({
    queryKey: end ? ["costs", start, end] : [POLL, "costs", start],
    queryFn: ({ signal }) => apiGet<CostsResponse>("costs", { start, end }, { signal }),
    staleTime: end ? 10 * MIN : 50_000,
  });

/** Time-bucketed readings. `live` refreshes it with every reading (for ranges that include now). */
export const historyQuery = (p: { start: number; end: number; points: number; fields: string[]; live?: boolean }) =>
  queryOptions({
    queryKey: [...(p.live ? [POLL] : []), "history", p.start, p.end, p.points, p.fields.join()],
    queryFn: ({ signal }) =>
      apiGet<HistoryResponse>(
        "history",
        { start: p.start, end: p.end, points: p.points, fields: p.fields.join(",") },
        { signal },
      ),
    staleTime: p.live ? 50_000 : 10 * MIN,
  });
