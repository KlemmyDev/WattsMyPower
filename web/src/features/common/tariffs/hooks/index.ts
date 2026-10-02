import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "~/features/common/api/utils";
import { patchSystem, POLL } from "~/features/common/live/api";
import type { Tariff } from "~/features/common/tariffs/types";

/** Save the tariff, then reprice everything that used the old rates. */
export function useSaveTariff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: Tariff) => apiSend<Tariff>("PUT", "tariff", t),
    onSuccess: (tariff) => {
      qc.setQueryData(["tariff"], tariff);
      patchSystem(qc, { tariff });
      qc.invalidateQueries({ queryKey: [POLL] });
      qc.invalidateQueries({ queryKey: ["costs"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}
