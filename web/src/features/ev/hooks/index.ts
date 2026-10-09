import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  commandEv,
  configureEv,
  connectTessie,
  disconnectTesla,
  pairBluetooth,
  refreshDetails,
  removeEv,
} from "~/features/ev/api";
import type { EvDetails, TeslaStatus } from "~/features/ev/types";

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

/** Read a car's details now (waking it only with `wake`): the answer is the new details, shown at once. */
export function useRefreshDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshDetails,
    onSuccess: (d: EvDetails) => {
      qc.setQueryData(["tesla", "details", d.vin], d);
      void qc.invalidateQueries({ queryKey: ["tesla"], exact: true });
      void qc.invalidateQueries({ queryKey: ["tesla", "log"] });
      void qc.invalidateQueries({ queryKey: ["tesla", "history", d.vin] });
    },
  });
}
