import { useQuery } from "@tanstack/react-query";
import { liveQuery } from "~/features/common/live/api";

/** The latest status from the inverter poller (undefined until the first response). */
export function useLive() {
  return useQuery(liveQuery).data;
}
