import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { CarView, ChargeEstimate, ChargeRequest, PlannedCharge } from "~/features/car/types";

export const carQuery = queryOptions({
  queryKey: ["car"],
  queryFn: ({ signal }) => apiGet<CarView>("car", undefined, { signal }),
  staleTime: 60_000,
});

/** What a charge would come to, before it's planned (nothing is saved). */
export const estimateQuery = (req: ChargeRequest) =>
  queryOptions({
    queryKey: ["car", "estimate", req],
    queryFn: () => apiSend<ChargeEstimate>("POST", "car/estimate", req),
    staleTime: Infinity,
    retry: false,
  });

export const addCharge = (req: ChargeRequest) => apiSend<PlannedCharge>("POST", "car/charges", req);

export const removeCharge = (id: number) => apiSend<{ ok: true }>("DELETE", `car/charges/${id}`);
