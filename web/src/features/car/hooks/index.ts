import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCharge, addPlan, createCar, deleteCar, removeCharge, setLevel, updateCar } from "~/features/car/api";

/** Refresh the cars, and the forecast that counts their charges. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["car"] });
    void qc.invalidateQueries({ queryKey: ["forecast"] });
  };
}

/** Plan a charge (or a suggested plan in steps) or remove one. */
export function useChargeChange() {
  const done = useRefresh();
  return {
    add: useMutation({ mutationFn: addCharge, onSuccess: done }),
    addPlan: useMutation({ mutationFn: addPlan, onSuccess: done }),
    remove: useMutation({ mutationFn: removeCharge, onSuccess: done }),
  };
}

/** Connect a car, change one, or disconnect one. */
export function useCarChange() {
  const done = useRefresh();
  return {
    create: useMutation({ mutationFn: createCar, onSuccess: done }),
    update: useMutation({ mutationFn: updateCar, onSuccess: done }),
    remove: useMutation({ mutationFn: deleteCar, onSuccess: done }),
  };
}

/** Give a car's level now, then refresh the cars and what's suggested from it. */
export function useSetLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setLevel,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["car"] }),
  });
}
