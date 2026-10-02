import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { DailyRow } from "~/features/history/types";

export const dailyQuery = (start: number, end: number) =>
  queryOptions({
    queryKey: ["daily", start, end],
    queryFn: ({ signal }) => apiGet<DailyRow[]>("daily", { start, end }, { signal }),
    staleTime: 10 * 60_000,
  });

/** Download link for a range's raw readings. */
export const exportCsvUrl = (start: number, end: number) => `/api/export.csv?start=${start}&end=${end}`;

/** What the database holds; `history_from` is when the recorded history starts. */
export const statsQuery = queryOptions({
  queryKey: ["stats"],
  queryFn: ({ signal }) =>
    apiGet<{ history_from: number | null; first_ts: number | null; last_ts: number | null }>("stats", undefined, {
      signal,
    }),
  staleTime: 60 * 60_000,
});
