import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "~/features/common/api/utils";
import { liveQuery, patchSystem } from "~/features/common/live/api";
import { SYSTEM_SETTINGS, type Settings } from "~/features/common/settings/types";

/** Save the forecast location, billing period or system details, and refresh what depends on it. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Settings>) => apiSend<Settings>("PUT", "settings", changes),
    onSuccess: (saved, changes) => {
      patchSystem(qc, saved);
      if ("latitude" in changes || "longitude" in changes) qc.invalidateQueries({ queryKey: ["forecast"] });
      if ("bill_months" in changes || "bill_day" in changes || "bill_anchor" in changes)
        qc.invalidateQueries({ queryKey: ["bills"] });
      if (SYSTEM_SETTINGS.some((k) => k in changes)) {
        // The capacity and reserve in use also depend on what the inverter reports: fetch them afresh.
        qc.invalidateQueries({ queryKey: liveQuery.queryKey });
        qc.invalidateQueries({ queryKey: ["forecast"] });
        qc.invalidateQueries({ queryKey: ["insights"] });
      }
    },
  });
}
