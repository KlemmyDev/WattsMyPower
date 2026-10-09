import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLive } from "~/features/common/live/hooks/useLive";
import {
  commandEv,
  configureEv,
  connectTessie,
  disconnectTesla,
  pairBluetooth,
  refreshDetails,
  removeEv,
} from "~/features/ev/api";
import type { EvControl, EvDetails, EvTimingKey, TeslaStatus } from "~/features/ev/types";

const CONFIGURE = ["tesla", "configure"];
const TIMING_KEYS: EvTimingKey[] = [
  "start_after",
  "stop_after",
  "min_switch",
  "amps_every",
  "average",
  "lead",
  "battery_full",
];

/** Connect through Tessie or pair over Bluetooth, change how a car charges, or command it: the answer is the new
 * status, so it's shown at once; the cars (whose levels and details it changes), the activity and whether a car's
 * asleep (a command wakes it) refresh after. */
export function useEvChange() {
  const qc = useQueryClient();
  const done = (status: TeslaStatus) => {
    qc.setQueryData(["tesla"], status);
    void qc.invalidateQueries({ queryKey: ["tesla", "log"] });
    void qc.invalidateQueries({ queryKey: ["tesla", "details"] });
    void qc.invalidateQueries({ queryKey: ["car"] });
  };
  return {
    connect: useMutation({ mutationFn: connectTessie, onSuccess: done }),
    pair: useMutation({ mutationFn: pairBluetooth, onSuccess: done }),
    disconnect: useMutation({ mutationFn: disconnectTesla, onSuccess: done }),
    remove: useMutation({ mutationFn: removeEv, onSuccess: done }),
    // How a car charges shows as chosen at once, without waiting on the server (put back if it's refused). While
    // another change is still on its way, an answer would show the one before it: the last answer is the one shown.
    configure: useMutation({
      mutationKey: CONFIGURE,
      mutationFn: configureEv,
      onMutate: async ({ vin, ...body }) => {
        await qc.cancelQueries({ queryKey: ["tesla"], exact: true });
        const before = qc.getQueryData<TeslaStatus>(["tesla"]);
        const control: Partial<EvControl> = {};
        if (body.mode !== undefined) control.mode = body.mode;
        if (body.first !== undefined) control.first = body.first;
        if (body.grid_w !== undefined) control.grid_w = body.grid_w;
        for (const key of TIMING_KEYS) {
          const value = body[key];
          if (value !== undefined) control[key] = value ?? before?.timing[key].default; // null: its default
        }
        if (before)
          qc.setQueryData<TeslaStatus>(["tesla"], {
            ...before,
            vehicles: before.vehicles.map((v) => (v.vin === vin ? { ...v, control: { ...v.control, ...control } } : v)),
          });
        return { before };
      },
      onError: (_e, _body, ctx) => {
        if (ctx?.before && qc.isMutating({ mutationKey: CONFIGURE }) === 1) qc.setQueryData(["tesla"], ctx.before);
      },
      onSuccess: (status) => {
        if (qc.isMutating({ mutationKey: CONFIGURE }) === 1) done(status);
        else void qc.invalidateQueries({ queryKey: ["tesla", "log"] });
      },
    }),
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

/** What the cars charging at home are drawing from the house now (W): 0 with none. A car charging elsewhere isn't. */
export function useHomeCharging(): number {
  const ev = useLive()?.ev;
  return (ev ?? [])
    .filter((c) => c.status === "charging" && c.at_home !== false && c.power_kw)
    .reduce((a, c) => a + (c.power_kw ?? 0) * 1000, 0);
}
