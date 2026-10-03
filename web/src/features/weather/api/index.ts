import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { WeatherDay, WeatherDaySummary, WeatherStatus } from "~/features/weather/types";

export const weatherStatusQuery = queryOptions({
  queryKey: ["weather", "status"],
  queryFn: ({ signal }) => apiGet<WeatherStatus>("weather", undefined, { signal }),
  // Every couple of seconds while past weather is being filled in, so its progress shows.
  refetchInterval: (q) => (q.state.data?.backfill.running ? 2_000 : 5 * 60_000),
});

export const weatherDayQuery = (date: string) =>
  queryOptions({
    queryKey: ["weather", "day", date],
    queryFn: ({ signal }) => apiGet<WeatherDay>("weather/day", { date }, { signal }),
    staleTime: 10 * 60_000,
  });

/** Each day's weather summed up, from `start` up to (not including) `end` (YYYY-MM-DD). */
export const weatherDaysQuery = (start: string, end: string) =>
  queryOptions({
    queryKey: ["weather", "days", start, end],
    queryFn: ({ signal }) => apiGet<WeatherDaySummary[]>("weather/days", { start, end }, { signal }),
    staleTime: 10 * 60_000,
  });

/** Fill in past weather now, all of it, rather than a little each half hour; `refetch` fetches every day again. */
export const startBackfill = (refetch = false) =>
  apiSend<{ started: boolean; backfill: WeatherStatus["backfill"] }>(
    "POST",
    refetch ? "weather/backfill?refetch=true" : "weather/backfill",
  );

/** Retrain the forecast's learned model now. */
export const retrain = () => apiSend<unknown>("POST", "weather/retrain");
