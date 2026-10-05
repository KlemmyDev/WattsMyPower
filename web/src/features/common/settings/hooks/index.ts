import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "~/features/common/api/utils";
import { liveQuery, patchSystem } from "~/features/common/live/api";
import {
  BILL_SETTINGS,
  OWNERSHIP_SETTINGS,
  SYSTEM_SETTINGS,
  WEATHER_SETTINGS,
  type Settings,
} from "~/features/common/settings/types";

/** Save the forecast location, billing period, bill discounts and budget, or system details, and refresh what depends on it. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Settings>) => apiSend<Settings>("PUT", "settings", changes),
    onSuccess: (saved, changes) => {
      patchSystem(qc, saved);
      if (WEATHER_SETTINGS.some((k) => k in changes)) {
        qc.invalidateQueries({ queryKey: ["forecast"] });
        qc.invalidateQueries({ queryKey: ["weather"] });
      }
      if (BILL_SETTINGS.some((k) => k in changes)) qc.invalidateQueries({ queryKey: ["bills"] });
      // The bill alert says whether it has a budget to watch.
      if ("bill_budget" in changes) qc.invalidateQueries({ queryKey: ["alerts"] });
      if (SYSTEM_SETTINGS.some((k) => k in changes)) {
        // The capacity and reserve in use also depend on what the inverter reports: fetch them afresh.
        qc.invalidateQueries({ queryKey: liveQuery.queryKey });
        qc.invalidateQueries({ queryKey: ["forecast"] });
        qc.invalidateQueries({ queryKey: ["insights"] });
      }
      if (OWNERSHIP_SETTINGS.some((k) => k in changes)) {
        qc.invalidateQueries({ queryKey: ["insights"] });
        qc.invalidateQueries({ queryKey: ["bills"] });
      }
    },
  });
}
