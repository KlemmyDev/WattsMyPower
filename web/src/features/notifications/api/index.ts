import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { ChannelKind, Notifications, Options, PushDevice } from "~/features/notifications/types";

/** The rules, channels, browsers turned on, options and recent history. */
export const notificationsQuery = queryOptions({
  queryKey: ["notifications"],
  queryFn: ({ signal }) => apiGet<Notifications>("notifications", undefined, { signal }),
  refetchInterval: 30_000,
});

export const saveRule = (
  rule: string,
  body: { enabled?: boolean; values?: Record<string, number>; channels?: string[] | null },
) => apiSend<Notifications>("PUT", `notifications/rules/${rule}`, body);

export const saveOptions = (body: Partial<Options>) => apiSend<Notifications>("PUT", "notifications/options", body);

export const saveChannel = (kind: ChannelKind, body: Record<string, unknown>) =>
  apiSend<Notifications>("PUT", `notifications/channels/${kind}`, body);

export const removeChannel = (kind: ChannelKind) => apiSend<Notifications>("DELETE", `notifications/channels/${kind}`);

/** Send a test to "push" (every browser), one browser by id, "ntfy" or "webhook". */
export const sendTest = (target: string) =>
  apiSend<Notifications & { result: string }>("POST", "notifications/test", { target });

export const addDevice = (subscription: unknown, name: string) =>
  apiSend<PushDevice>("POST", "notifications/push/devices", { subscription, name });

export const removeDevice = (id: string) => apiSend<{ removed: boolean }>("DELETE", `notifications/push/devices/${id}`);
