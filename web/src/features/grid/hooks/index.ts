import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "~/features/common/readings/api";
import { addDays, midnight } from "~/features/common/time/utils";

const FIELDS = ["grid_power", "grid_voltage", "grid_freq"];

/** The grid through today, every 5 minutes (power, voltage, frequency), as the Grid page's cards draw them. */
export function useGridDay(now: number) {
  const start = midnight(now);
  const { data } = useQuery(historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }));
  return { start, series: data?.series };
}
