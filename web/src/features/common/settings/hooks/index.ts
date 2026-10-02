import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "~/features/common/api/utils";
import { patchSystem } from "~/features/common/live/api";
import type { Settings } from "~/features/common/settings/types";

/** Save the forecast location or billing period, and refresh what depends on it. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Settings>) => apiSend<Settings>("PUT", "settings", changes),
    onSuccess: (saved, changes) => {
      patchSystem(qc, saved);
      if ("latitude" in changes || "longitude" in changes) qc.invalidateQueries({ queryKey: ["forecast"] });
      if ("bill_months" in changes || "bill_day" in changes || "bill_anchor" in changes)
        qc.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}
