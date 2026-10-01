import { useQuery } from "@tanstack/react-query";
import { forecastQuery } from "~/features/common/weather/api";

/** The next ~24 h forecast: undefined while loading, null when unavailable. */
export function useForecast() {
  const q = useQuery(forecastQuery);
  return q.isError ? null : q.data;
}
