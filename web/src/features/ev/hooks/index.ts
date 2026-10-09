import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commandEv, configureEv, connectTessie, disconnectTesla, pairBluetooth, removeEv } from "~/features/ev/api";
import type { TeslaStatus } from "~/features/ev/types";

/** Connect through Tessie or pair over Bluetooth, change how a car charges, or command it: the answer is the new
 * status, so it's shown at once; the cars (whose levels and details it changes) and the activity refresh after. */
export function useEvChange() {
  const qc = useQueryClient();
  const done = (status: TeslaStatus) => {
    qc.setQueryData(["tesla"], status);
    void qc.invalidateQueries({ queryKey: ["tesla", "log"] });
    void qc.invalidateQueries({ queryKey: ["car"] });
  };
  return {
    connect: useMutation({ mutationFn: connectTessie, onSuccess: done }),
    pair: useMutation({ mutationFn: pairBluetooth, onSuccess: done }),
    disconnect: useMutation({ mutationFn: disconnectTesla, onSuccess: done }),
    remove: useMutation({ mutationFn: removeEv, onSuccess: done }),
    configure: useMutation({ mutationFn: configureEv, onSuccess: done }),
    command: useMutation({ mutationFn: commandEv, onSuccess: done }),
  };
}
