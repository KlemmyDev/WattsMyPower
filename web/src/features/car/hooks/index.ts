import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCharge, addPlan, removeCharge, setLevel } from "~/features/car/api";

/** Plan a charge (or a suggested plan in steps) or remove one, then refresh the list and the forecast that counts it. */
export function useChargeChange() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["car"] });
    void qc.invalidateQueries({ queryKey: ["forecast"] });
  };
  return {
    add: useMutation({ mutationFn: addCharge, onSuccess: done }),
    addPlan: useMutation({ mutationFn: addPlan, onSuccess: done }),
    remove: useMutation({ mutationFn: removeCharge, onSuccess: done }),
  };
}

/** Give the car's level now, then refresh the car and what's suggested from it. */
export function useSetLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setLevel,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["car"] }),
  });
}
