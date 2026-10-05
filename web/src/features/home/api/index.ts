import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { DevicePattern, DeviceRaw, HomeOverview, HomeRun, HomeUsage } from "~/features/home/types";

const MIN = 60_000;

/** The integrations, their accounts and every device with what it's doing. Devices are read every minute. */
export const homeQuery = queryOptions({
  queryKey: ["home"],
  queryFn: ({ signal }) => apiGet<HomeOverview>("home", undefined, { signal }),
  staleTime: 30_000,
  refetchInterval: MIN,
});

/** Where the home's power went over [start, end), by the hour or day. */
export const homeUsageQuery = (start: number, end: number, bucket: "hour" | "day") =>
  queryOptions({
    queryKey: ["home", "usage", start, end, bucket],
    queryFn: ({ signal }) => apiGet<HomeUsage>("home/usage", { start, end, bucket }, { signal }),
    staleTime: MIN,
    refetchInterval: 5 * MIN,
  });

/** Each device's habits over the last eight weeks. */
export const homePatternsQuery = queryOptions({
  queryKey: ["home", "patterns"],
  queryFn: ({ signal }) => apiGet<DevicePattern[]>("home/patterns", undefined, { signal }),
  staleTime: 10 * MIN,
});

/** Runs that started in [start, end), newest first. */
export const homeRunsQuery = (start: number, end: number, device?: number) =>
  queryOptions({
    queryKey: ["home", "runs", start, end, device],
    queryFn: ({ signal }) => apiGet<HomeRun[]>("home/runs", { start, end, device }, { signal }),
    staleTime: MIN,
  });

/** A device's properties as its integration last sent them. */
export const deviceRawQuery = (id: number) =>
  queryOptions({
    queryKey: ["home", "raw", id],
    queryFn: ({ signal }) => apiGet<DeviceRaw>(`home/devices/${id}/raw`, undefined, { signal }),
  });

export const connectHome = ({ id, form }: { id: string; form: Record<string, string> }) =>
  apiSend<HomeOverview>("POST", `home/integrations/${id}`, form);

export const signInHomeAgain = ({ id, form }: { id: string; form: Record<string, string> }) =>
  apiSend<HomeOverview>("PUT", `home/integrations/${id}`, form);

export const disconnectHome = (id: string) => apiSend<HomeOverview>("DELETE", `home/integrations/${id}`);

export const updateDevice = ({ id, ...changes }: { id: number; name?: string; kind?: string; hidden?: boolean }) =>
  apiSend<HomeOverview>("PATCH", `home/devices/${id}`, changes);
