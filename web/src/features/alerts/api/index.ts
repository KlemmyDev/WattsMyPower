import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { AlertChannel, AlertRule, AlertsOverview, ChannelKind, RuleChange } from "~/features/alerts/types";

/** Channels, rules and recent alerts. Refreshed every minute, as rules are checked about that often. */
export const alertsQuery = queryOptions({
  queryKey: ["alerts"],
  queryFn: ({ signal }) => apiGet<AlertsOverview>("alerts", undefined, { signal }),
  refetchInterval: 60_000,
});

export const saveChannel = (kind: ChannelKind, body: Record<string, string | boolean>) =>
  apiSend<AlertChannel>("PUT", `alerts/channels/${kind}`, body);

export const removeChannel = (kind: ChannelKind) => apiSend<{ removed: boolean }>("DELETE", `alerts/channels/${kind}`);

/** Send a test with the settings in the form (an empty body uses the saved ones). */
export const testChannel = (kind: ChannelKind, body: Record<string, string>) =>
  apiSend<{ ok: true }>("POST", `alerts/channels/${kind}/test`, body);

export const saveRule = (id: string, change: RuleChange) => apiSend<AlertRule>("PUT", `alerts/rules/${id}`, change);
