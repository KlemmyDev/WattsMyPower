import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, apiUpload } from "~/features/common/api/utils";
import type { MeterFileSummary, MeterImport, MeterPreview, Reconciliation } from "~/features/meter/types";

export const meterImportsQuery = queryOptions({
  queryKey: ["meter", "imports"],
  queryFn: ({ signal }) => apiGet<MeterImport[]>("meter/imports", undefined, { signal }),
});

export const reconcileQuery = queryOptions({
  queryKey: ["meter", "reconcile"],
  queryFn: ({ signal }) => apiGet<Reconciliation>("meter/reconcile", undefined, { signal }),
});

/** What a NEM12 file holds, without importing it. */
export const previewMeterFile = (file: File) => apiUpload<MeterPreview>("meter/preview", file);

export const importMeterFile = (file: File) => apiUpload<MeterFileSummary & { id: number }>("meter/imports", file);

export const removeMeterImport = (id: number) => apiSend<{ removed: boolean }>("DELETE", `meter/imports/${id}`);

/** Meter data changed: refresh the imports, the comparison, and the bills and costs that use it. */
export function meterChanged(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["meter"] });
  qc.invalidateQueries({ queryKey: ["bills"] });
  qc.invalidateQueries({ queryKey: ["costs"] });
}
