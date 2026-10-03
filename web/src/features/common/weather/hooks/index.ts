import { useQuery } from "@tanstack/react-query";
import { useLive } from "~/features/common/live/hooks/useLive";
import { accuracyQuery, forecastQuery } from "~/features/common/weather/api";

/** The next ~24 h forecast: undefined while loading, null when unavailable. */
export function useForecast() {
  const q = useQuery(forecastQuery);
  return q.isError ? null : q.data;
}

/** Whether temperatures show in °F (Settings → Integrations → Weather). */
export function useFahrenheit() {
  return !!useLive()?.system.temp_unit_f;
}

/** How close the day-ahead solar forecast has come: undefined while loading, null when unavailable. */
export function useForecastAccuracy() {
  const q = useQuery(accuracyQuery);
  return q.isError ? null : q.data;
}
