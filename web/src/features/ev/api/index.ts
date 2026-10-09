import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { EvCommand, EvControl, EvEvent, TeslaStatus } from "~/features/ev/types";

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
