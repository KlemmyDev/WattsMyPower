import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { PlanComparison, Savings } from "~/features/savings/types";

export const savingsQuery = queryOptions({
  queryKey: ["savings"],
  queryFn: ({ signal }) => apiGet<Savings>("savings", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});

/** A year of this home's usage priced on each of a retailer's current plans. Slow the first time. */
export const planCompareQuery = (brand: string, postcode: string) =>
  queryOptions({
    queryKey: ["plans", "compare", brand, postcode],
    queryFn: ({ signal }) => apiGet<PlanComparison>("plans/compare", { brand, postcode }, { signal }),
    staleTime: 60 * 60_000,
    retry: false,
  });
