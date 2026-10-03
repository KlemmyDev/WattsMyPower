import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { AmberPrices, AmberStatus } from "~/features/amber/types";

const MIN = 60_000;

/** The Amber connection. Refreshed every minute while shown, as prices arrive in the background. */
export const amberQuery = queryOptions({
  queryKey: ["amber"],
  queryFn: ({ signal }) => apiGet<AmberStatus>("amber", undefined, { signal }),
  staleTime: MIN,
  refetchInterval: MIN,
});

/** Amber's prices for [start, end): the day's so far and its forecast. Amber updates them every 5 minutes. */
export const amberPricesQuery = (start: number, end: number) =>
  queryOptions({
    queryKey: ["amber", "prices", start, end],
    queryFn: ({ signal }) => apiGet<AmberPrices>("amber/prices", { start, end }, { signal }),
    staleTime: MIN,
    refetchInterval: MIN,
  });

export const connectAmber = (apiKey: string) => apiSend<AmberStatus>("PUT", "amber", { api_key: apiKey });

export const chooseAmberSite = (siteId: string) => apiSend<AmberStatus>("PUT", "amber/site", { site_id: siteId });

export const disconnectAmber = () => apiSend<AmberStatus>("DELETE", "amber");
