import { useMutation, useQueryClient } from "@tanstack/react-query";
import { batteryQuery, setExperimental, startControl, stopControl } from "~/features/battery/api";
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

/** Whether the system has a home battery: its size, as the inverter reports it or as set in Manage → System. */
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
