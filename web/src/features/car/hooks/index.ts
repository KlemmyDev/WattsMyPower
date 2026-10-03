import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCharge, removeCharge } from "~/features/car/api";

/** Plan or remove a charge, then refresh the list and the forecast that counts it. */
export function useChargeChange() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["car"] });
    void qc.invalidateQueries({ queryKey: ["forecast"] });
  };
  return {
    add: useMutation({ mutationFn: addCharge, onSuccess: done }),
    remove: useMutation({ mutationFn: removeCharge, onSuccess: done }),
  };
}
