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

const GRID_SETTINGS = [
  "nem_region",
  "power_network",
  "home_street",
  "home_suburb",
  "outage_radius_km",
  "hazard_warnings",
  "latitude",
  "longitude",
] as const;

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
      if (SYSTEM_SETTINGS.some((k) => k in changes)) {
        // The capacity and reserve in use also depend on what the inverter reports: fetch them afresh.
        qc.invalidateQueries({ queryKey: liveQuery.queryKey });
        qc.invalidateQueries({ queryKey: ["forecast"] });
        qc.invalidateQueries({ queryKey: ["insights"] });
      }
      // The grid's region, network, street or radius: the page asks again now, and once more when the server has
      // fetched for the new one in the background.
      if (GRID_SETTINGS.some((k) => k in changes)) {
        qc.invalidateQueries({ queryKey: ["grid"] });
        setTimeout(() => qc.invalidateQueries({ queryKey: ["grid"] }), 5000);
      }
      // Checking for updates turned on or off.
      if ("update_check" in changes) qc.invalidateQueries({ queryKey: ["updates"] });
      if (OWNERSHIP_SETTINGS.some((k) => k in changes)) {
        qc.invalidateQueries({ queryKey: ["insights"] });
        qc.invalidateQueries({ queryKey: ["bills"] });
      }
    },
  });
}
