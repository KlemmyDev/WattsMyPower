import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { EmbedPower, EmbedStatus } from "~/features/embed/types";

/** Whether the shared power summary is on, and its token (signed in only). */
export const embedQuery = queryOptions({
  queryKey: ["embed"],
  queryFn: ({ signal }) => apiGet<EmbedStatus>("embed", undefined, { signal }),
});

/** Turn sharing on, or make a new link (the old one stops working). */
export const createEmbed = () => apiSend<EmbedStatus>("POST", "embed");

/** Turn sharing off. */
export const revokeEmbed = () => apiSend<EmbedStatus>("DELETE", "embed");

/** The live power figures for the shared page, which only the token opens. Refreshed every 10 seconds. */
export const embedPowerQuery = (token: string) =>
  queryOptions({
    queryKey: ["embed", "power", token],
    queryFn: ({ signal }) => apiGet<EmbedPower>("embed/public/power", { token }, { signal }),
    refetchInterval: 10_000,
    retry: false,
  });
