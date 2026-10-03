import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { WeatherDay, WeatherStatus } from "~/features/weather/types";

export const weatherStatusQuery = queryOptions({
  queryKey: ["weather", "status"],
  queryFn: ({ signal }) => apiGet<WeatherStatus>("weather", undefined, { signal }),
  // Faster while past weather is being filled in, so its progress shows.
  refetchInterval: (q) => (q.state.data?.backfill.running ? 15_000 : 5 * 60_000),
});

export const weatherDayQuery = (date: string) =>
  queryOptions({
    queryKey: ["weather", "day", date],
    queryFn: ({ signal }) => apiGet<WeatherDay>("weather/day", { date }, { signal }),
    staleTime: 10 * 60_000,
  });

/** Fill in past weather now rather than at the next half-hourly run. */
export const startBackfill = () => apiSend<{ started: boolean }>("POST", "weather/backfill");

/** Retrain the forecast's learned model now. */
export const retrain = () => apiSend<unknown>("POST", "weather/retrain");
