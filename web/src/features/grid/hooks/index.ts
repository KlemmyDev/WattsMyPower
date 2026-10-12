import { useQuery } from "@tanstack/react-query";
import { historyQuery } from "~/features/common/readings/api";
import { addDays, midnight } from "~/features/common/time/utils";

const FIELDS = ["grid_power", "grid_voltage", "grid_freq"];
const DAYS = 14; // the days a usual one is worked out from

/** The grid through today, every 5 minutes (power, voltage, frequency), as the Grid page's cards draw them. */
export function useGridDay(now: number) {
  const start = midnight(now);
  const { data } = useQuery(historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }));
  return { start, series: data?.series };
}

const median = (vs: number[]) => {
  if (!vs.length) return null;
  const s = [...vs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * What a usual day buys from the grid, from the last two weeks' running totals every half hour: by this time of day
 * (`byNow`) and in all (`day`), the middle of the days that have readings. Nulls until there are a few.
 */
export function useUsualImport(now: number): { byNow: number | null; day: number | null } {
  const today = midnight(now);
  const from = addDays(today, -DAYS);
  const { data } = useQuery(historyQuery({ start: from, end: today, points: DAYS * 48, fields: ["daily_import"] }));
  const s = data?.series;
  if (!s) return { byNow: null, day: null };
  const since = now - today;
  const byNow: number[] = [];
  const day: number[] = [];
  for (let d = 0; d < DAYS; d++) {
    const a = addDays(from, d);
    const b = addDays(a, 1);
    let total = -1;
    let sofar = 0;
    s.t.forEach((t, i) => {
      const v = s.daily_import?.[i];
      if (v == null || t < a || t >= b) return;
      total = Math.max(total, v);
      if (t - a <= since) sofar = Math.max(sofar, v);
    });
    if (total < 0) continue;
    day.push(total);
    byNow.push(sofar);
  }
  return day.length >= 3 ? { byNow: median(byNow), day: median(day) } : { byNow: null, day: null };
}
