import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useNow } from "~/features/common/time/hooks";
import { useToast } from "~/features/common/ui/components/Toast";
import { integrationsQuery, removeInverter } from "~/features/integrations/api";
import type { InverterRole } from "~/features/integrations/types";
import { inverterState } from "~/features/integrations/utils";

/** What's connected (the query, for its loading and error states), with each inverter's live state. */
export function useInverters() {
  const query = useQuery(integrationsQuery);
  const live = useLive();
  const snapshot = useSnapshot();
  const now = useNow();
  const inverters = (query.data?.devices ?? []).map((d) => inverterState(d, live, snapshot, now));
  return { ...query, inverters };
}

/**
 * Stop reading an inverter, then refresh what's connected. `mutate` takes its name as shown, since its
 * reported model is gone from the stream once it's removed.
 */
export function useRemoveInverter(role: InverterRole, onRemoved?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (_name: string) => removeInverter(role),
    onSuccess: (_, name) => {
      toast(`Stopped reading the ${name}.`);
      onRemoved?.();
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
}
