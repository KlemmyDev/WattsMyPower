import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { kW } from "~/features/common/formatting/utils/number";
import type { NavPage } from "~/features/common/layout/utils";
import {
  clearDeviceRule,
  connectHome,
  disconnectHome,
  findHomeDevices,
  homeQuery,
  setDeviceRule,
  signInHomeAgain,
  switchDevice,
  updateDevice,
} from "~/features/home/api";
import type { HomeDevice, HomeOverview } from "~/features/home/types";
import { deviceColors, drawing, homeItems, reading } from "~/features/home/utils";

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
    setRule: useMutation({ mutationFn: setDeviceRule, onSuccess: done }),
    clearRule: useMutation({ mutationFn: clearDeviceRule, onSuccess: done }),
  };
}

/**
 * Home's pages for the navigation: each room (a group of plugs, as one) and each device in no room, with what it's
 * drawing now. A room is the current page on its own page and on any of its devices'. Only fetched while `enabled`
 * (in the Home section).
 */
export function useHomeNavPages(enabled: boolean): NavPage[] {
  const { data } = useQuery({ ...homeQuery, enabled });
  const path = useRouterState({ select: (s) => s.location.pathname });
  let here = path;
  try {
    here = decodeURIComponent(path);
  } catch {
    /* not encoded as expected: compare it as it is */
  }
  const items = homeItems(data?.devices ?? []);
  // Each room in its first device's colour, as the Home page draws it.
  const colors = deviceColors(data?.devices ?? []);
  const draws = (members: HomeDevice[]) => members.reduce((a, d) => a + (drawing(d) ?? 0), 0);
  const top = Math.max(1, ...items.map((i) => draws(i.members)));
  return items.map((item): NavPage => {
    const w = draws(item.members);
    if (item.group)
      return {
        key: `room:${item.group}`,
        label: item.group,
        link: { to: "/home/rooms/$room", params: { room: item.group } },
        value: w ? kW(w) : "Idle",
        share: w / top,
        color: colors.get(item.id),
        active: here === `/home/rooms/${item.group}` || item.members.some((d) => here === `/home/${d.id}`),
      };
    const d = item.members[0];
    return {
      key: String(d.id),
      label: d.name,
      link: { to: "/home/$device", params: { device: String(d.id) } },
      value: reading(d),
      share: w / top,
      color: colors.get(d.id),
      active: here === `/home/${d.id}`,
    };
  });
}
