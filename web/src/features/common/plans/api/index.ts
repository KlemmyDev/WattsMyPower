import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Brand } from "~/features/common/plans/types";

/** Energy retailers that publish plans (from the CDR register, cached by the server for a day). */
export const brandsQuery = queryOptions({
  queryKey: ["plans", "brands"],
  queryFn: ({ signal }) => apiGet<Brand[]>("plans/brands", undefined, { signal }),
  staleTime: 24 * 60 * 60_000,
});
