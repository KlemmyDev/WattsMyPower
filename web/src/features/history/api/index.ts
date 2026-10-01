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
