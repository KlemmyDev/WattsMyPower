import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { EvCommand, EvControl, EvDetails, EvEvent, EvHistory, EvLevels, TeslaStatus } from "~/features/ev/types";

/** How the Teslas are reached, and each car. Refreshed every 30 seconds while shown (the car changes as it charges),
 * and every 2 while a car is being paired. */
export const teslaQuery = queryOptions({
  queryKey: ["tesla"],
  queryFn: ({ signal }) => apiGet<TeslaStatus>("tesla", undefined, { signal }),
  staleTime: 15_000,
  refetchInterval: (q) => (pairing(q.state.data) ? 2_000 : 30_000),
});

/** Whether a car is being paired over Bluetooth now. */
export const pairing = (s: TeslaStatus | undefined) =>
  s?.bluetooth.pairing?.step === "looking" || s?.bluetooth.pairing?.step === "tap";

/** What the dashboard did with the cars, newest first. */
export const teslaLogQuery = (limit: number) =>
  queryOptions({
    queryKey: ["tesla", "log", limit],
    queryFn: ({ signal }) => apiGet<{ events: EvEvent[] }>("tesla/log", { limit }, { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

export const connectTessie = (token: string) => apiSend<TeslaStatus>("PUT", "tesla/tessie", { token });

/** Start pairing a car over Bluetooth; the answer says it's under way. */
export const pairBluetooth = (vin: string) => apiSend<TeslaStatus>("POST", "tesla/bluetooth", { vin });

export const disconnectTesla = () => apiSend<TeslaStatus>("DELETE", "tesla");

export const removeEv = (vin: string) => apiSend<TeslaStatus>("DELETE", `tesla/vehicles/${vin}`);

export const configureEv = ({
  vin,
  ...body
}: Partial<EvControl> & { vin: string; car?: number; home?: "here" | null }) =>
  apiSend<TeslaStatus>("PUT", `tesla/vehicles/${vin}`, body);

export const commandEv = ({ vin, ...body }: EvCommand & { vin: string }) =>
  apiSend<TeslaStatus>("POST", `tesla/vehicles/${vin}/command`, body);

/** A car's details beyond its charge. Refreshed every minute while shown: reading them never wakes the car. */
export const detailsQuery = (vin: string) =>
  queryOptions({
    queryKey: ["tesla", "details", vin],
    queryFn: ({ signal }) => apiGet<EvDetails>(`tesla/vehicles/${vin}/details`, undefined, { signal }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

/** Read a car's details now. Without `wake`, an asleep car answers 409 (and the page asks before waking it). */
export const refreshDetails = ({ vin, wake }: { vin: string; wake: boolean }) =>
  apiSend<EvDetails>("POST", `tesla/vehicles/${vin}/details`, { wake });

/** A car's in and out over the last `days`: time away and charges at home. */
export const historyQuery = (vin: string, days: number) =>
  queryOptions({
    queryKey: ["tesla", "history", vin, days],
    queryFn: ({ signal }) => apiGet<EvHistory>(`tesla/vehicles/${vin}/history`, { days }, { signal }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

/** A car's level through [start, end), with when it was away and when it charged. */
export const levelsQuery = (vin: string, start: number, end: number) =>
  queryOptions({
    queryKey: ["tesla", "levels", vin, start, end],
    queryFn: ({ signal }) => apiGet<EvLevels>(`tesla/vehicles/${vin}/levels`, { start, end }, { signal }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
