import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Bills } from "~/features/bills/types";

export const billsQuery = queryOptions({
  queryKey: ["bills"],
  queryFn: ({ signal }) => apiGet<Bills>("bills", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});
