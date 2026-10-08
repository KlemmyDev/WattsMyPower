import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { UpdateStatus } from "~/features/updates/types";

const MIN = 60_000;

/** This version and the latest on GitHub. The server checks every few hours, so this needn't ask often. */
export const updatesQuery = queryOptions({
  queryKey: ["updates"],
  queryFn: ({ signal }) => apiGet<UpdateStatus>("updates", undefined, { signal }),
  staleTime: 10 * MIN,
  refetchInterval: 60 * MIN,
});

/** Check GitHub now. */
export const checkForUpdates = () => apiSend<UpdateStatus>("POST", "updates/check");

/** Update now: ask the updater on the machine it's installed on to run install.sh. It starts within a minute. */
export const installUpdate = () => apiSend<UpdateStatus>("POST", "updates/install");
