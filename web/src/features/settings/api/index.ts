import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { PlanSearch } from "~/features/settings/types";

/** A retailer's current residential plans at a postcode (Energy Made Easy). */
export const planSearchQuery = (brand: string, postcode: string, q: string) =>
  queryOptions({
    queryKey: ["plans", "search", brand, postcode, q],
    queryFn: ({ signal }) => apiGet<PlanSearch>("plans/search", { brand, postcode, q }, { signal }),
    staleTime: 60 * 60_000,
    retry: false,
  });
