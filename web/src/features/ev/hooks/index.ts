import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLive } from "~/features/common/live/hooks/useLive";
import {
  commandEv,
  configureEv,
  connectBluelink,
  connectByd,
  connectTessie,
  disconnectBluelink,
  disconnectByd,
  disconnectTesla,
  refreshBluelink,
  refreshByd,
  setBluelinkPin,
  pairBluetooth,
  refreshDetails,
  removeEv,
} from "~/features/ev/api";
import type {
  BluelinkStatus,
  BydStatus,
  EvBrand,
  EvControl,
  EvDetails,
  EvTimingKey,
  TeslaStatus,
} from "~/features/ev/types";

const TIMING_KEYS: EvTimingKey[] = [
  "start_after",
  "stop_after",
  "min_switch",
  "amps_every",
  "average",
  "lead",
  "battery_full",
];

type Statuses = TeslaStatus | BluelinkStatus;

/** Connect through Tessie or pair over Bluetooth, change how a car charges, or command it: the answer is the new
 * status, so it's shown at once; the cars (whose levels and details it changes), the activity and whether a car's
 * asleep (a command wakes it) refresh after. `brand`: whose cars it changes and commands (a Tesla's, or a Hyundai or
 * Kia's: the same changes and commands, sent to its own integration). */
export function useEvChange(brand: EvBrand = "tesla") {
  const qc = useQueryClient();
  const configureKey = [brand, "configure"];
  const done = (status: Statuses) => {
    qc.setQueryData([brand], status);
    if (brand !== "tesla") return;
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
      mutationKey: configureKey,
      mutationFn: (body: Parameters<typeof configureEv>[0]) => configureEv({ ...body, brand }),
      onMutate: async ({ vin, ...body }) => {
        await qc.cancelQueries({ queryKey: [brand], exact: true });
        const before = qc.getQueryData<Statuses>([brand]);
        const control: Partial<EvControl> & { charge_w?: number | null; force_every?: number } = {};
        if (body.mode !== undefined) control.mode = body.mode;
        if (body.first !== undefined) control.first = body.first;
        if (body.grid_w !== undefined) control.grid_w = body.grid_w;
        if (body.charge_w !== undefined) control.charge_w = body.charge_w;
        if (body.force_every !== undefined) control.force_every = body.force_every;
        for (const key of TIMING_KEYS) {
          const value = body[key];
          if (value !== undefined) control[key] = value ?? before?.timing[key].default; // null: its default
        }
        if (before)
          qc.setQueryData<Statuses>([brand], {
            ...before,
            vehicles: before.vehicles.map((v) => (v.vin === vin ? { ...v, control: { ...v.control, ...control } } : v)),
          } as Statuses);
        return { before };
      },
      onError: (_e, _body, ctx) => {
        if (ctx?.before && qc.isMutating({ mutationKey: configureKey }) === 1) qc.setQueryData([brand], ctx.before);
      },
      onSuccess: (status) => {
        if (qc.isMutating({ mutationKey: configureKey }) === 1) done(status);
        else if (brand === "tesla") void qc.invalidateQueries({ queryKey: ["tesla", "log"] });
      },
    }),
    command: useMutation({
      mutationFn: (body: Parameters<typeof commandEv>[0]) => commandEv({ ...body, brand }),
      onSuccess: done,
    }),
  };
}

/** Sign in to BYD, read its cars now, or disconnect: the answer is the new status, shown at once. */
export function useBydChange() {
  const qc = useQueryClient();
  const done = (status: BydStatus) => qc.setQueryData(["byd"], status);
  return {
    connect: useMutation({ mutationFn: connectByd, onSuccess: done }),
    refresh: useMutation({ mutationFn: refreshByd, onSuccess: done }),
    disconnect: useMutation({ mutationFn: disconnectByd, onSuccess: done }),
  };
}

/** Sign in to Hyundai's or Kia's cloud, read the cars now (or ask one itself), set the app's PIN, or disconnect: the
 * answer is the new status, shown at once. */
export function useBluelinkChange() {
  const qc = useQueryClient();
  const done = (status: BluelinkStatus) => qc.setQueryData(["bluelink"], status);
  return {
    connect: useMutation({ mutationFn: connectBluelink, onSuccess: done }),
    refresh: useMutation({ mutationFn: refreshBluelink, onSuccess: done }),
    pin: useMutation({ mutationFn: setBluelinkPin, onSuccess: done }),
    disconnect: useMutation({ mutationFn: disconnectBluelink, onSuccess: done }),
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
