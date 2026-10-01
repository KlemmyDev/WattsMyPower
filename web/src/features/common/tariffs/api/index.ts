import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Tariff } from "~/features/common/tariffs/types";

/** The saved tariff, fresh from the server (the live status carries a copy too). */
export const tariffQuery = queryOptions({
  queryKey: ["tariff"],
  queryFn: ({ signal }) => apiGet<Tariff>("tariff", undefined, { signal }),
  staleTime: 0,
});
