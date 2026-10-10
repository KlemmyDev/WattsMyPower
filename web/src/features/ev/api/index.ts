import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type {
  BluelinkBrand,
  BluelinkStatus,
  BydStatus,
  EvBrand,
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

/** A change to how a car charges, for its integration (`brand`: a Tesla's, else a Hyundai or Kia's). */
export const configureEv = ({
  vin,
  brand = "tesla",
  ...body
}: EvControlChange & { vin: string; brand?: EvBrand; car?: number | null; home?: "here" | null }) =>
  apiSend<TeslaStatus | BluelinkStatus>("PUT", `${brand}/vehicles/${vin}`, body);

export const commandEv = ({ vin, brand = "tesla", ...body }: EvCommand & { vin: string; brand?: EvBrand }) =>
  apiSend<TeslaStatus | BluelinkStatus>("POST", `${brand}/vehicles/${vin}/command`, body);

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

/** The Hyundai or Kia account and its cars. Refreshed every 30 seconds while shown (the dashboard steers them each
 * turn of its loop; the cloud's read every few minutes), every 3 while a read's under way. */
export const bluelinkQuery = queryOptions({
  queryKey: ["bluelink"],
  queryFn: ({ signal }) => apiGet<BluelinkStatus>("bluelink", undefined, { signal }),
  staleTime: 15_000,
  refetchInterval: (q) => (q.state.data?.reading ? 3_000 : 30_000),
});

/** Sign in to Hyundai's or Kia's cloud, checked by reading the account's cars. */
export const connectBluelink = (body: {
  username: string;
  password: string;
  pin: string;
  brand: BluelinkBrand;
  region: string;
}) => apiSend<BluelinkStatus>("PUT", "bluelink", body);

/** Read the cars now, from the cloud; with `force`, ask that car itself (it wakes its modem). */
export const refreshBluelink = (force?: string) =>
  apiSend<BluelinkStatus>("POST", "bluelink/refresh", force ? { force } : {});

export const setBluelinkPin = (pin: string) => apiSend<BluelinkStatus>("PUT", "bluelink/pin", { pin });

export const disconnectBluelink = () => apiSend<BluelinkStatus>("DELETE", "bluelink");

/** A car's level through [start, end), with when it was away and when it charged. */
export const levelsQuery = (vin: string, start: number, end: number) =>
  queryOptions({
    queryKey: ["tesla", "levels", vin, start, end],
    queryFn: ({ signal }) => apiGet<EvLevels>(`tesla/vehicles/${vin}/levels`, { start, end }, { signal }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
