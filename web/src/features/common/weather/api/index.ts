import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Forecast, ForecastAccuracy } from "~/features/common/weather/types";

export const forecastQuery = queryOptions({
  queryKey: ["forecast"],
  // null when the forecast is turned off or Open-Meteo can't be reached
  queryFn: ({ signal }) => apiGet<Forecast | null>("forecast", undefined, { signal }),
  staleTime: 10 * 60_000,
  refetchInterval: 10 * 60_000,
});

/** How close the day-ahead solar forecast has come, and the likely range that gives the days ahead. */
export const accuracyQuery = queryOptions({
  queryKey: ["forecast", "accuracy"],
  queryFn: ({ signal }) => apiGet<ForecastAccuracy>("forecast/accuracy", undefined, { signal }),
  staleTime: 60 * 60_000,
});
