import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type {
  ConnectedInverter,
  ConnectRequest,
  ConnectResult,
  IntegrationsOverview,
  InverterRole,
  ScanState,
} from "~/features/integrations/types";

export const integrationsQuery = queryOptions({
  queryKey: ["integrations"],
  queryFn: ({ signal }) => apiGet<IntegrationsOverview>("integrations", undefined, { signal }),
});

/** The network scan's progress: polled every second while it runs. */
export const scanQuery = queryOptions({
  queryKey: ["integrations", "scan"],
  queryFn: ({ signal }) => apiGet<ScanState>("integrations/scan", undefined, { signal }),
  refetchInterval: (q) => (q.state.data?.running ? 1000 : false),
});

export const startScan = (network: string) => apiSend<ScanState>("POST", "integrations/scan", { network });

export const connectInverter = (role: InverterRole, body: ConnectRequest) =>
  apiSend<ConnectResult>("PUT", `integrations/${role}`, body);

export const updateInverter = (role: InverterRole, changes: { behind_meter: boolean }) =>
  apiSend<ConnectedInverter>("PATCH", `integrations/${role}`, changes);

export const removeInverter = (role: InverterRole) => apiSend<{ removed: boolean }>("DELETE", `integrations/${role}`);
