import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { kW } from "~/features/common/formatting/utils/number";
import {
  NAV_ROW,
  NAV_ROW_ACTIVE,
  NavColumnHeader,
  NavColumnLabel,
  NavRow,
} from "~/features/common/layout/components/NavColumn";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { homeQuery } from "~/features/home/api";
import type { HomeDevice } from "~/features/home/types";
import { deviceColors, homeItems } from "~/features/home/utils";

/** What a device draws now, if it has a fresh reading and is drawing anything to speak of (2 W, as Home counts it). */
const liveW = (d: HomeDevice) => {
  const w = d.now && d.now.online && !d.now.stale ? d.now.power_w : null;
  return w != null && w >= 2 ? w : null;
};

/** A device's reading in a word or two. */
function reading(d: HomeDevice) {
  if (!d.now || d.now.stale) return "—";
  if (!d.now.online) return "Offline";
  const w = liveW(d);
  return w != null ? kW(w) : "Idle";
}

/**
 * Home's column in the side nav: every device, room by room, with what it's drawing now and a bar for its share of the
 * busiest, each linking to its page.
 */
export function HomeNavColumn() {
  const overview = useQuery(homeQuery);
  const load = useSnapshot()?.load_power;
  const devices = overview.data?.devices ?? [];
  const colors = deviceColors(devices);
  const items = homeItems(devices);
  const rooms = items.filter((i) => i.group);
  const singles = items.filter((i) => !i.group).map((i) => i.members[0]);
  const top = Math.max(1, ...devices.filter((d) => !d.hidden).map((d) => liveW(d) ?? 0));

  const row = (d: HomeDevice) => (
    <Link
      key={d.id}
      to="/home/$device"
      params={{ device: String(d.id) }}
      activeProps={NAV_ROW_ACTIVE}
      className={NAV_ROW}
    >
      <NavRow color={colors.get(d.id)} label={d.name} value={reading(d)} share={(liveW(d) ?? 0) / top} />
    </Link>
  );

  return (
    <>
      <NavColumnHeader
        to="/home"
        title="Home"
        sub={load != null && load > 0 ? `Using ${kW(load)} now` : "Where your home's power goes"}
      />
      {rooms.map((room) => {
        const w = room.members.reduce((a, d) => a + (liveW(d) ?? 0), 0);
        return (
          <div key={room.id} className="flex flex-col">
            <NavColumnLabel aside={w ? kW(w) : undefined}>{room.group}</NavColumnLabel>
            {room.members.map(row)}
          </div>
        );
      })}
      {singles.length > 0 && (
        <div className="flex flex-col">
          <NavColumnLabel aside="now">{rooms.length ? "Other devices" : "Devices"}</NavColumnLabel>
          {singles.map(row)}
        </div>
      )}
      {overview.isSuccess && !items.length && (
        <p className="px-2.5 pt-2 text-[13px] leading-snug text-ink-muted">
          No devices yet.{" "}
          <Link to="/settings/integrations" className="text-link no-underline hover:text-link-hover">
            Connect smart plugs or appliances
          </Link>{" "}
          to see what each one uses.
        </p>
      )}
    </>
  );
}
