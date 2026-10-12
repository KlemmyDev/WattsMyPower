import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { batteryQuery, insightsQuery, setExperimental, startControl, stopControl } from "~/features/battery/api";
import { historyQuery } from "~/features/common/readings/api";
import { addDays, midnight } from "~/features/common/time/utils";
import { liveQuery } from "~/features/common/live/api";
import type { BatteryView } from "~/features/battery/types";
import { noBattery } from "~/features/battery/utils";
import { useLive } from "~/features/common/live/hooks/useLive";
import type { BatteryMode } from "~/features/common/live/types";

/** Start or stop a battery control, or turn the controls on for an untried model; each answers with the battery as it
 * now is. */
export function useBatteryChange() {
  const qc = useQueryClient();
  const done = (view: BatteryView) => {
    qc.setQueryData(batteryQuery.queryKey, view);
    void qc.invalidateQueries({ queryKey: ["battery", "history"] }); // the chart's shaded controls
    void qc.invalidateQueries({ queryKey: ["battery", "log"] }); // and what they did
    void qc.invalidateQueries({ queryKey: liveQuery.queryKey }); // a floor changes the reserve shown everywhere
  };
  return {
    start: useMutation({ mutationFn: startControl, onSuccess: done }),
    stop: useMutation({ mutationFn: stopControl, onSuccess: done }),
    experiment: useMutation({ mutationFn: setExperimental, onSuccess: done }),
  };
}

/** Whether the system has a home battery: its size, as the inverter reports it or as set in Settings. */
export function useHasBattery(): boolean {
  return (useLive()?.system.battery_kwh ?? 0) > 0;
}

/** Whether it's known there's no home battery, to leave it out (see `noBattery`); false while that's not known yet. */
export function useNoBattery(): boolean {
  return noBattery(useLive()?.system);
}

/** What the battery is set to do, from the live status (null when its battery can't be controlled from here). */
export function useBatteryMode(): BatteryMode | null {
  return useLive()?.battery_mode ?? null;
}

const DAY_FIELDS = ["battery_power", "grid_power", "pv_power", "load_power", "battery_temp"];

/** The battery's day so far, every 5 minutes (what the Battery page's cards draw from), while there's a battery. */
export function useBatteryDay(now: number) {
  const has = useHasBattery();
  const start = midnight(now);
  const { data } = useQuery({
    ...historyQuery({ start, end: addDays(start, 1), points: 288, fields: DAY_FIELDS, live: true }),
    enabled: has,
  });
  return { start, series: data?.series };
}

/** What the battery's controls can do and are doing (undefined until read, or where it can't be controlled). */
export function useBatteryView() {
  const has = useHasBattery();
  const { data } = useQuery({ ...batteryQuery, enabled: has });
  return data?.supported ? data : undefined;
}

/** The battery's health, its last 30 days and whether its size suits the house. */
export function useBatteryInsights() {
  const has = useHasBattery();
  return useQuery({ ...insightsQuery, enabled: has });
}
