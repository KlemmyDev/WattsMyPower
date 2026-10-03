import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { amberPricesQuery, amberQuery, chooseAmberSite, connectAmber, disconnectAmber } from "~/features/amber/api";
import type { AmberStatus } from "~/features/amber/types";
import { POLL } from "~/features/common/live/api";
import { addDays, midnight } from "~/features/common/time/utils";

/** Connect, choose a site, or disconnect; each answers with the new connection status. */
export function useAmberChange() {
  const qc = useQueryClient();
  const done = (status: AmberStatus) => {
    qc.setQueryData(amberQuery.queryKey, status);
    void qc.invalidateQueries({ queryKey: ["amber", "prices"] });
  };
  return {
    connect: useMutation({ mutationFn: connectAmber, onSuccess: done }),
    site: useMutation({ mutationFn: chooseAmberSite, onSuccess: done }),
    disconnect: useMutation({
      mutationFn: disconnectAmber,
      onSuccess: (status) => {
        done(status);
        // A tariff on Amber prices goes back to a single rate: reprice everything.
        for (const key of [["tariff"], [POLL], ["costs"], ["bills"]]) void qc.invalidateQueries({ queryKey: key });
      },
    }),
  };
}

/**
 * Amber's prices from midnight today to midnight tomorrow night (so the next few hours are covered
 * late in the day too), while Amber is connected with a site chosen. Undefined otherwise.
 */
export function useAmberPrices(now: number, enabled = true) {
  const status = useQuery({ ...amberQuery, enabled });
  const start = midnight(now);
  const ready = enabled && !!status.data?.site_id;
  const prices = useQuery({ ...amberPricesQuery(start, addDays(start, 2)), enabled: ready });
  return ready ? prices.data : undefined;
}
