import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { BatteryView, ControlRequest } from "~/features/battery/types";

/** The battery's settings, who has it and the control in effect. Reading them asks the inverter (at most every 20
 * seconds, however many are watching), so it's only refreshed while the card is on screen. */
export const batteryQuery = queryOptions({
  queryKey: ["battery"],
  queryFn: ({ signal }) => apiGet<BatteryView>("battery", undefined, { signal }),
  staleTime: 15_000,
  refetchInterval: 30_000,
});

export const startControl = (body: ControlRequest) => apiSend<BatteryView>("POST", "battery/control", body);

export const stopControl = () => apiSend<BatteryView>("DELETE", "battery/control");
