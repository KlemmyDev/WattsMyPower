import { useMutation } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { Place } from "~/features/settings/types";

/** Search places for the forecast location (OpenStreetMap). Run on submit, not as you type. */
export function useGeocode() {
  return useMutation({ mutationFn: (q: string) => apiGet<Place[]>("geocode", { q }) });
}
