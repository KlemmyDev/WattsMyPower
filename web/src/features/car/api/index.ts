import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type {
  CarLevel,
  CarModel,
  CarView,
  ChargeEstimate,
  ChargeRequest,
  PlannedCharge,
  PlanRequest,
  SuggestRequest,
  Suggestions,
} from "~/features/car/types";

export const carQuery = queryOptions({
  queryKey: ["car"],
  queryFn: ({ signal }) => apiGet<CarView>("car", undefined, { signal }),
  staleTime: 60_000,
});

/** Cars to choose from when connecting one. */
export const carModelsQuery = queryOptions({
  queryKey: ["car", "models"],
  queryFn: ({ signal }) => apiGet<CarModel[]>("car/models", undefined, { signal }),
  staleTime: Infinity,
});

/** What a charge would come to, before it's planned (nothing is saved). */
export const estimateQuery = (req: ChargeRequest) =>
  queryOptions({
    queryKey: ["car", "estimate", req],
    queryFn: () => apiSend<ChargeEstimate>("POST", "car/estimate", req),
    staleTime: Infinity,
    retry: false,
  });

/**
 * The best times to charge the car. Under "car" so a change to the car or its charges refreshes it, and kept for a
 * few minutes: the forecast and prices it's worked out from don't move faster than that.
 */
export const suggestQuery = (req: SuggestRequest) =>
  queryOptions({
    queryKey: ["car", "suggest", req],
    queryFn: () => apiSend<Suggestions>("POST", "car/suggest", req),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const addCharge = (req: ChargeRequest) => apiSend<PlannedCharge>("POST", "car/charges", req);

export const addPlan = (req: PlanRequest) => apiSend<PlannedCharge[]>("POST", "car/plans", req);

export const removeCharge = (id: number) => apiSend<{ ok: true }>("DELETE", `car/charges/${id}`);

export const setLevel = (soc: number) => apiSend<CarLevel>("POST", "car/level", { soc });
