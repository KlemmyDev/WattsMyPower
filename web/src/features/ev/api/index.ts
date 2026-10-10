import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type {
  BydStatus,
  EvCommand,
  EvControlChange,
  EvDetails,
  EvHistory,
  EvLevels,
  KeyRole,
  TeslaStatus,
} from "~/features/ev/types";

/** How the Teslas are reached, and each car. Refreshed every 30 seconds while shown (the car changes as it charges),
 * every 2 while a car is being paired, and just after each read of the cars (so what it found shows at once). */
export const teslaQuery = queryOptions({
  queryKey: ["tesla"],
  queryFn: ({ signal }) => apiGet<TeslaStatus>("tesla", undefined, { signal }),
  staleTime: 15_000,
  refetchInterval: (q) => {
    const s = q.state.data;
    if (pairing(s)) return 2_000;
    if (s?.reading) return 3_000;
    if (s?.next_read == null) return 30_000;
    // Once it's due, the server starts the read within a tick of its loop.
    const due = (s.next_read - Date.now() / 1000 + 3) * 1000;
    return Math.min(30_000, Math.max(3_000, due));
  },
});

/** Whether a car is being paired over Bluetooth now. */
export const pairing = (s: TeslaStatus | undefined) =>
  s?.bluetooth.pairing?.step === "looking" || s?.bluetooth.pairing?.step === "tap";

export const connectTessie = (token: string) => apiSend<TeslaStatus>("PUT", "tesla/tessie", { token });

/** Start pairing a car over Bluetooth, its key in `role`; the answer says it's under way. */
export const pairBluetooth = ({ vin, role }: { vin: string; role: KeyRole }) =>
  apiSend<TeslaStatus>("POST", "tesla/bluetooth", { vin, role });

export const disconnectTesla = () => apiSend<TeslaStatus>("DELETE", "tesla");

export const removeEv = (vin: string) => apiSend<TeslaStatus>("DELETE", `tesla/vehicles/${vin}`);

export const configureEv = ({
  vin,
  ...body
}: EvControlChange & { vin: string; car?: number | null; home?: "here" | null }) =>
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

/** The BYD account and its cars. Refreshed every 30 seconds while shown (they're read every few minutes), every 3
 * while a read's under way. */
export const bydQuery = queryOptions({
  queryKey: ["byd"],
  queryFn: ({ signal }) => apiGet<BydStatus>("byd", undefined, { signal }),
  staleTime: 15_000,
  refetchInterval: (q) => (q.state.data?.reading ? 3_000 : 30_000),
});

/** Sign in to BYD, checked by reading the account's cars. */
export const connectByd = (body: { username: string; password: string; region: string }) =>
  apiSend<BydStatus>("PUT", "byd", body);

export const refreshByd = () => apiSend<BydStatus>("POST", "byd/refresh");

export const disconnectByd = () => apiSend<BydStatus>("DELETE", "byd");

/** A car's level through [start, end), with when it was away and when it charged. */
export const levelsQuery = (vin: string, start: number, end: number) =>
  queryOptions({
    queryKey: ["tesla", "levels", vin, start, end],
    queryFn: ({ signal }) => apiGet<EvLevels>(`tesla/vehicles/${vin}/levels`, { start, end }, { signal }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
