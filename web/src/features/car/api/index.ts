import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { CarChanges, CarModel, CarView } from "~/features/car/types";

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

export const createCar = (body: CarChanges) => apiSend<CarView>("POST", "cars", body);

export const updateCar = ({ id, ...body }: CarChanges & { id: number }) => apiSend<CarView>("PUT", `cars/${id}`, body);

export const deleteCar = (id: number) => apiSend<{ ok: true }>("DELETE", `cars/${id}`);
