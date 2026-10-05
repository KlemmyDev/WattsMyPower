import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { DevicePattern, DeviceRaw, HomeOverview, HomeRun, HomeUsage } from "~/features/home/types";

const MIN = 60_000;

/** The integrations, their accounts and every device with what it's doing: plugs on the network are read every 15
 * seconds, so it's refreshed as often. */
export const homeQuery = queryOptions({
  queryKey: ["home"],
  queryFn: ({ signal }) => apiGet<HomeOverview>("home", undefined, { signal }),
  staleTime: 10_000,
  refetchInterval: 15_000,
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

/** What a connect form left blank falls back to: the home network devices are looked for on. */
export const homeHintsQuery = queryOptions({
  queryKey: ["home", "hints"],
  queryFn: ({ signal }) => apiGet<{ network: string | null }>("home/hints", undefined, { signal }),
  staleTime: 5 * MIN,
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

/** Look for devices added since (Look for new plugs): everything connected, and what was found, in words. */
export const findHomeDevices = (id: string) =>
  apiSend<HomeOverview & { found: { new: number; answered: number; message: string } }>(
    "POST",
    `home/integrations/${id}/find`,
  );

export const disconnectHome = (id: string) => apiSend<HomeOverview>("DELETE", `home/integrations/${id}`);

export const updateDevice = ({
  id,
  ...changes
}: {
  id: number;
  name?: string;
  kind?: string;
  hidden?: boolean;
  /** A group's name, or null to take it out of its group. */
  group?: string | null;
}) => apiSend<HomeOverview>("PATCH", `home/devices/${id}`, changes);

/** Switch a device on or off. A fridge or freezer is only switched off with `confirm`. */
export const switchDevice = ({ id, on, confirm }: { id: number; on: boolean; confirm?: boolean }) =>
  apiSend<HomeOverview>("POST", `home/devices/${id}/switch`, { on, confirm: !!confirm });
