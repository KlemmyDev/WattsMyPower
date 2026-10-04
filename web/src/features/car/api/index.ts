import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type {
  CarChanges,
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

/** Every car connected. Everything about the cars is under "car", so a change to one refreshes it all. */
export const carsQuery = queryOptions({
  queryKey: ["car"],
  queryFn: ({ signal }) => apiGet<CarView[]>("cars", undefined, { signal }),
  staleTime: 60_000,
});

/** Cars to choose from when connecting one. */
export const carModelsQuery = queryOptions({
  queryKey: ["car", "models"],
  queryFn: ({ signal }) => apiGet<CarModel[]>("cars/models", undefined, { signal }),
  staleTime: Infinity,
});

/** What a charge would come to, before it's planned (nothing is saved). */
export const estimateQuery = (car: number, req: ChargeRequest) =>
  queryOptions({
    queryKey: ["car", "estimate", car, req],
    queryFn: () => apiSend<ChargeEstimate>("POST", `cars/${car}/estimate`, req),
    staleTime: Infinity,
    retry: false,
  });

/**
 * The best times to charge a car, kept for a few minutes: the forecast and prices it's worked out from don't move
 * faster than that.
 */
export const suggestQuery = (car: number, req: SuggestRequest) =>
  queryOptions({
    queryKey: ["car", "suggest", car, req],
    queryFn: () => apiSend<Suggestions>("POST", `cars/${car}/suggest`, req),
    staleTime: 5 * 60_000,
    retry: false,
  });

export const createCar = (body: CarChanges) => apiSend<CarView>("POST", "cars", body);

export const updateCar = ({ id, ...body }: CarChanges & { id: number }) => apiSend<CarView>("PUT", `cars/${id}`, body);

export const deleteCar = (id: number) => apiSend<{ ok: true }>("DELETE", `cars/${id}`);

export const addCharge = ({ car, ...req }: ChargeRequest & { car: number }) =>
  apiSend<PlannedCharge>("POST", `cars/${car}/charges`, req);

export const addPlan = ({ car, ...req }: PlanRequest & { car: number }) =>
  apiSend<PlannedCharge[]>("POST", `cars/${car}/plans`, req);

export const removeCharge = (id: number) => apiSend<{ ok: true }>("DELETE", `cars/charges/${id}`);

export const setLevel = ({ car, soc }: { car: number; soc: number }) =>
  apiSend<CarLevel>("POST", `cars/${car}/level`, { soc });
