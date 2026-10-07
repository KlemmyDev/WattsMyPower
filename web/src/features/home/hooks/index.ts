import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { homeItems } from "~/features/home/utils";

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

/** What a device draws now, if it has a fresh reading and is drawing anything to speak of (2 W, as Home counts it). */
const drawing = (d: HomeDevice) => {
  const w = d.now && d.now.online && !d.now.stale ? d.now.power_w : null;
  return w != null && w >= 2 ? w : null;
};

/** A device's reading in a word or two. */
function reading(d: HomeDevice) {
  if (!d.now || d.now.stale) return "—";
  if (!d.now.online) return "Offline";
  const w = drawing(d);
  return w != null ? kW(w) : "Idle";
}

/**
 * Home's pages for the navigation: each visible device, room by room (then the ones in no room), with what it's
 * drawing now. Only fetched while `enabled` (in the Home section).
 */
export function useHomeNavPages(enabled: boolean): NavPage[] {
  const { data } = useQuery({ ...homeQuery, enabled });
  const items = homeItems(data?.devices ?? []);
  const rooms = items.filter((i) => i.group);
  const top = Math.max(1, ...items.flatMap((i) => i.members.map((d) => drawing(d) ?? 0)));
  const page = (d: HomeDevice, group?: string, groupValue?: string): NavPage => ({
    key: String(d.id),
    label: d.name,
    link: { to: "/home/$device", params: { device: String(d.id) } },
    value: reading(d),
    share: (drawing(d) ?? 0) / top,
    group,
    groupValue,
  });
  return [
    ...rooms.flatMap((room) => {
      const w = room.members.reduce((a, d) => a + (drawing(d) ?? 0), 0);
      return room.members.map((d) => page(d, room.group!, w ? kW(w) : undefined));
    }),
    ...items.filter((i) => !i.group).map((i) => page(i.members[0], rooms.length ? "Other devices" : undefined)),
  ];
}
