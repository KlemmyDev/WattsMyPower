import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  connectHome,
  disconnectHome,
  findHomeDevices,
  homeQuery,
  signInHomeAgain,
  switchDevice,
  updateDevice,
} from "~/features/home/api";
import type { HomeOverview } from "~/features/home/types";

/** Connect, sign in again, look for new devices, disconnect, change a device, or switch one; each answers with everything connected, as it now is. */
export function useHomeChange() {
  const qc = useQueryClient();
  const done = (overview: HomeOverview) => {
    qc.setQueryData(homeQuery.queryKey, overview);
    // What each device used, and so the breakdown, changes with what's connected and what's hidden.
    for (const key of ["usage", "patterns", "runs"]) void qc.invalidateQueries({ queryKey: ["home", key] });
  };
  return {
    connect: useMutation({ mutationFn: connectHome, onSuccess: done }),
    signIn: useMutation({ mutationFn: signInHomeAgain, onSuccess: done }),
    disconnect: useMutation({ mutationFn: disconnectHome, onSuccess: done }),
    find: useMutation({ mutationFn: findHomeDevices, onSuccess: done }),
    update: useMutation({ mutationFn: updateDevice, onSuccess: done }),
    switch: useMutation({ mutationFn: switchDevice, onSuccess: done }),
  };
}
