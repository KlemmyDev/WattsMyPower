import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCar, deleteCar, updateCar } from "~/features/car/api";

/** Connect a car, change one, or disconnect one; then refresh the cars, and the EVs linked to them. */
export function useCarChange() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["car"] });
    void qc.invalidateQueries({ queryKey: ["tesla"] });
  };
  return {
    create: useMutation({ mutationFn: createCar, onSuccess: done }),
    update: useMutation({ mutationFn: updateCar, onSuccess: done }),
    remove: useMutation({ mutationFn: deleteCar, onSuccess: done }),
  };
}
