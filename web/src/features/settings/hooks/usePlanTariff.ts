import { useMutation } from "@tanstack/react-query";
import { apiGet } from "~/features/common/api/utils";
import type { PlanTariff } from "~/features/settings/types";

/** Convert a published plan into a tariff for the editor (not saved). */
export function usePlanTariff() {
  return useMutation({
    mutationFn: ({ brand, plan }: { brand: string; plan: string }) =>
      apiGet<PlanTariff>("plans/tariff", { brand, plan }),
  });
}
