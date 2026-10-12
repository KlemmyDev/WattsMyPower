import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "~/features/common/readings/api";
import { addDays, dateKey, midnight } from "~/features/common/time/utils";
import { weatherDayQuery } from "~/features/weather/api";

const FIELDS = ["pv_power", "pv1_power", "pv2_power", "mppt1_v", "mppt1_a", "mppt2_v", "mppt2_a"];

/** Today's solar every 5 minutes, and the day's weather, as the Solar page's cards draw them. */
export function useSolarDay(now: number) {
  const start = midnight(now);
  const { data } = useQuery(historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }));
  const { data: weather } = useQuery(weatherDayQuery(dateKey(now)));
  return { start, series: data?.series, weather };
}
