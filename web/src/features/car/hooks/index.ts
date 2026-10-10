import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteCar, updateCar } from "~/features/car/api";

/** Change a car or remove one; then refresh the cars, and the Teslas tied to them. */
export function useCarChange() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["car"] });
    void qc.invalidateQueries({ queryKey: ["tesla"] });
  };
  return {
    update: useMutation({ mutationFn: updateCar, onSuccess: done }),
    remove: useMutation({ mutationFn: deleteCar, onSuccess: done }),
  };
}
