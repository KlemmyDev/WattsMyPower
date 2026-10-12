import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { Dashboard, DashboardsDoc } from "~/features/dashboards/types";

export const dashboardsQuery = queryOptions({
  queryKey: ["dashboards"],
  queryFn: ({ signal }) => apiGet<DashboardsDoc>("dashboards", undefined, { signal }),
  staleTime: Infinity,
});

/** Keep the dashboards, whole. */
export const saveDashboards = (dashboards: Dashboard[]) => apiSend<DashboardsDoc>("PUT", "dashboards", { dashboards });

/** Back to the default. */
export const resetDashboards = () => apiSend<DashboardsDoc>("DELETE", "dashboards");
