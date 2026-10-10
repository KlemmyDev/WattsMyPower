import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { BatteryEvent, BatteryPlan, BatteryView, ControlRecord, ControlRequest } from "~/features/battery/types";
import type { Insights } from "~/features/battery/types/insights";

/** The battery's settings, who has it and the control in effect. Reading them asks the inverter (at most every 20
 * seconds, however many are watching), so it's only refreshed while the card is on screen. */
export const batteryQuery = queryOptions({
  queryKey: ["battery"],
  queryFn: ({ signal }) => apiGet<BatteryView>("battery", undefined, { signal }),
  staleTime: 15_000,
  refetchInterval: 30_000,
});

/** What a control would do if started now: worked out on the server from the forecast and your rates. */
export const previewQuery = (body: ControlRequest | null) =>
  queryOptions({
    queryKey: ["battery", "preview", body],
    queryFn: () => apiSend<BatteryPlan>("POST", "battery/preview", body ?? undefined),
    enabled: body != null,
    staleTime: 60_000,
  });

/** The controls in effect over [start, end), for the day chart. */
export const controlHistoryQuery = (start: number, end: number) =>
  queryOptions({
    queryKey: ["battery", "history", start, end],
    queryFn: ({ signal }) => apiGet<{ controls: ControlRecord[] }>("battery/history", { start, end }, { signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

/** What the controls did lately, newest first, at most `limit`. */
export const batteryLogQuery = (limit: number) =>
  queryOptions({
    queryKey: ["battery", "log", limit],
    queryFn: ({ signal }) => apiGet<{ events: BatteryEvent[] }>("battery/log", { limit }, { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

export const startControl = (body: ControlRequest) => apiSend<BatteryView>("POST", "battery/control", body);

export const stopControl = () => apiSend<BatteryView>("DELETE", "battery/control");

/** Turn the controls on for this inverter though they haven't been tried on its model, or back off. */
export const setExperimental = (on: boolean) => apiSend<BatteryView>("PUT", "battery/experimental", { on });

/** The battery's health, cycles, warranty and sizing: worked out from history, so refreshed every few minutes. */
export const insightsQuery = queryOptions({
  queryKey: ["insights"],
  queryFn: ({ signal }) => apiGet<Insights>("insights", undefined, { signal }),
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
});
