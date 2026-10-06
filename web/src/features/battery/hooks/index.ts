import { useMutation, useQueryClient } from "@tanstack/react-query";
import { batteryQuery, startControl, stopControl } from "~/features/battery/api";
import { liveQuery } from "~/features/common/live/api";
import type { BatteryView } from "~/features/battery/types";
import { useLive } from "~/features/common/live/hooks/useLive";
import type { BatteryMode } from "~/features/common/live/types";

/** Start or stop a battery control; each answers with the battery as it now is. */
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
  };
}

/** Whether the system has a home battery: its size, as the inverter reports it or as set in Settings → System. */
export function useHasBattery(): boolean {
  return (useLive()?.system.battery_kwh ?? 0) > 0;
}

/** What the battery is set to do, from the live status (null when its battery can't be controlled from here). */
export function useBatteryMode(): BatteryMode | null {
  return useLive()?.battery_mode ?? null;
}
