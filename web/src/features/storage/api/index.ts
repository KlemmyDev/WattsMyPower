import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { StorageReport } from "~/features/storage/types";

/** Both databases measured. The server reuses a measure for 5 minutes; `measureAgain` asks for a new one. */
export const storageQuery = queryOptions({
  queryKey: ["storage"],
  queryFn: ({ signal }) => apiGet<StorageReport>("storage", undefined, { signal }),
  staleTime: 5 * 60_000,
});

export const measureAgain = () => apiGet<StorageReport>("storage", { fresh: true });
