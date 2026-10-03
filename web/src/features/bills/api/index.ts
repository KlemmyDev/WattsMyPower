import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Bills, GridHours, Payback } from "~/features/bills/types";

export const billsQuery = queryOptions({
  queryKey: ["bills"],
  queryFn: ({ signal }) => apiGet<Bills>("bills", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});

/** Grid use and what it cost by hour of the day, for each of the last 12 months. */
export const gridHoursQuery = queryOptions({
  queryKey: ["bills", "grid-hours"],
  queryFn: ({ signal }) => apiGet<GridHours>("bills/grid-hours", undefined, { signal }),
  staleTime: 30 * 60_000,
});

/** What the system has saved, and when it pays for itself. */
export const paybackQuery = queryOptions({
  queryKey: ["bills", "payback"],
  queryFn: ({ signal }) => apiGet<Payback>("bills/payback", undefined, { signal }),
  staleTime: 30 * 60_000,
});
